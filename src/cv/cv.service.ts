import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { HealthRegistry } from '../common/health/health.registry.js'
import { AppError } from '../common/http/app-error.js'
import { Metrics } from '../common/metrics/metrics.js'
import { texConfig } from '../config/config.js'
import { loadAssets, type TemplateAssets } from './assets.js'
import { buildContent } from './content.js'
import type { CvBuildRequest, CvMeasurement, CvTemplate } from './cv.schemas.js'
import {
    checkFonts,
    logTail,
    measureBlocks,
    pageFills,
    pagesWithTextOutside,
    parseBbox,
    parseLog,
    pdfPages,
} from './measure.js'
import { Slots, SlotsBusyError, TOOL_RUNNER, type ToolRunner } from './tools.js'

export type CvBuild = CvMeasurement & {
    pdf: Buffer
}

const MAX_WARNINGS = 200
const A4 = {
    widthPt: 595.276,
    heightPt: 841.89,
}
/** The binaries a build needs, each run with its version flag (readiness). */
const TOOLS: [
    string,
    string[],
][] = [
    [
        'xelatex',
        [
            '-version',
        ],
    ],
    [
        'pdfinfo',
        [
            '-v',
        ],
    ],
    [
        'pdffonts',
        [
            '-v',
        ],
    ],
    [
        'pdftotext',
        [
            '-v',
        ],
    ],
]
const PROBE_CACHE_MS = 30_000
const PROBE_TIMEOUT_MS = 1_500

/**
 * What xelatex and poppler get from the environment: no secrets (the token
 * stays in this process), a log that never wraps (one warning is one line),
 * and no reading or writing of files outside the build folder and the TeX
 * tree (`openin_any=p`, `openout_any=p`), on top of `-no-shell-escape` and the
 * escaping of every text value.
 */
function toolEnv(): NodeJS.ProcessEnv {
    const keep = [
        'PATH',
        'HOME',
        'TMPDIR',
        'LANG',
        'LC_ALL',
        'TEXMFVAR',
        'TEXMFCONFIG',
        'XDG_CACHE_HOME',
    ]
    return {
        ...Object.fromEntries(
            keep.flatMap(key =>
                process.env[key] === undefined
                    ? []
                    : [
                          [
                              key,
                              process.env[key],
                          ],
                      ],
            ),
        ),
        max_print_line: '10000',
        error_line: '254',
        half_error_line: '238',
        openin_any: 'p',
        openout_any: 'p',
    }
}

type Outcome = 'ok' | 'tex_error' | 'timeout' | 'busy' | 'failed'

/**
 * One build: content.tex from the CvDocument, two xelatex runs in a
 * temporary folder, then pages, fonts, block lines and page fill read back
 * with poppler. The folder is removed whatever happens. At most
 * TEX_CONCURRENCY builds run at once; the whole build has TEX_TIMEOUT_MS.
 */
@Injectable()
export class CvService implements OnModuleInit {
    private readonly logger = new Logger('CvBuild')
    private readonly slots: Slots
    private assets: Record<CvTemplate, TemplateAssets> | undefined
    private probe:
        | {
              at: number
              problem: string | null
          }
        | undefined
    private readonly builds
    private readonly seconds

    constructor(
        @Inject(texConfig.KEY) private readonly config: ConfigType<typeof texConfig>,
        @Inject(TOOL_RUNNER) private readonly tools: ToolRunner,
        private readonly health: HealthRegistry,
        metrics: Metrics,
    ) {
        const slots = new Slots(config.concurrency, config.queueMax)
        this.slots = slots
        this.builds = metrics.counter({
            name: 'tailor_tex_builds_total',
            help: 'CV builds by outcome.',
            labelNames: [
                'outcome',
            ],
        })
        this.seconds = metrics.histogram({
            name: 'tailor_tex_build_seconds',
            help: 'One build: two xelatex runs plus poppler, slot wait excluded.',
            buckets: [
                0.5,
                1,
                2,
                3,
                5,
                8,
                13,
                20,
                30,
                45,
            ],
        })
        metrics.gauge({
            name: 'tailor_tex_slots',
            help: 'Build slots by state: active (running) and waiting (queued).',
            labelNames: [
                'state',
            ],
            collect: function collect() {
                this.set(
                    {
                        state: 'active',
                    },
                    slots.state.active,
                )
                this.set(
                    {
                        state: 'waiting',
                    },
                    slots.state.waiting,
                )
            },
        })
    }

    async onModuleInit() {
        this.assets = await loadAssets()
        // The toolchain is part of this container: without it the pod is not ready.
        this.health.register('tex', () => this.toolchain(), {
            required: true,
        })
    }

    async build(request: CvBuildRequest): Promise<CvBuild> {
        try {
            const result = await this.slots.run(() => this.compile(request))
            this.builds.inc({
                outcome: 'ok',
            })
            return result
        } catch (error) {
            const outcome: Outcome =
                error instanceof SlotsBusyError
                    ? 'busy'
                    : error instanceof AppError && error.code === 'TIMEOUT'
                      ? 'timeout'
                      : error instanceof AppError && error.code === 'UNPROCESSABLE'
                        ? 'tex_error'
                        : 'failed'
            this.builds.inc({
                outcome,
            })
            if (error instanceof SlotsBusyError) throw new AppError('RATE_LIMITED', error.message)
            throw error
        }
    }

    private async compile(request: CvBuildRequest): Promise<CvBuild> {
        this.assets ??= await loadAssets()
        const assets = this.assets[request.template]
        const content = buildContent(request.document)
        const started = performance.now()
        const deadline = started + this.config.timeoutMs
        const dir = await mkdtemp(join(this.config.workDir, 'tailor-tex-'))
        try {
            await writeFile(join(dir, 'cv.tex'), assets.source)
            await writeFile(join(dir, 'content.tex'), content.tex)
            await linkFonts(assets.fontDir, join(dir, 'fonts'))
            const env = toolEnv()
            const run = async (command: string, args: string[]) => {
                const left = Math.floor(deadline - performance.now())
                const result =
                    left > 0
                        ? await this.tools.run(command, args, {
                              cwd: dir,
                              timeoutMs: left,
                              env,
                          })
                        : undefined
                if (!result || result.timedOut) {
                    this.logger.warn(
                        {
                            command,
                            timeoutMs: this.config.timeoutMs,
                        },
                        'CV build timed out',
                    )
                    throw new AppError('TIMEOUT', `TeX build timed out after ${this.config.timeoutMs / 1000} s`)
                }
                return result
            }

            for (let pass = 1; pass <= 2; pass++) {
                const result = await run('xelatex', [
                    '-interaction=nonstopmode',
                    '-halt-on-error',
                    '-no-shell-escape',
                    '-jobname=cv',
                    '\\def\\ContentFile{content}\\def\\FontDir{fonts/}\\input{cv}',
                ])
                if (result.code === 0) continue
                // Killed by a signal (the OOM killer at the memory limit) or not started: not the input's fault.
                if (result.code === null) throw new Error('xelatex was killed or did not start')
                const log = await readFile(join(dir, 'cv.log'), 'utf8').catch(() => result.output)
                const message = `xelatex failed (exit ${result.code})`
                // The log tail quotes CV text: it goes to the caller, never to logs.
                this.logger.warn(
                    {
                        pass,
                        code: result.code,
                    },
                    'CV build failed in TeX',
                )
                throw new AppError(
                    'UNPROCESSABLE',
                    message,
                    logTail(log).map(line => ({
                        path: 'log',
                        message: line,
                    })),
                )
            }

            const pdfPath = join(dir, 'cv.pdf')
            const tool = async (command: string, args: string[]) => {
                const result = await run(command, args)
                if (result.code !== 0) throw new Error(`${command} exited ${result.code}`)
                return result.output
            }
            const info = await tool('pdfinfo', [
                pdfPath,
            ])
            const fonts = await tool('pdffonts', [
                pdfPath,
            ])
            await tool('pdftotext', [
                '-bbox-layout',
                pdfPath,
                join(dir, 'bbox.html'),
            ])
            const [pdf, log, bbox] = await Promise.all([
                readFile(pdfPath),
                readFile(join(dir, 'cv.log'), 'utf8'),
                readFile(join(dir, 'bbox.html'), 'utf8'),
            ])

            const layout = parseBbox(bbox)
            const pages = pdfPages(info)
            const parsed = parseLog(log)
            const fontCheck = checkFonts(fonts, assets.postScriptNames)
            const blocks = measureBlocks(layout, content.blocks)
            const warnings = [
                ...parsed.warnings,
                ...fontCheck.problems,
            ]
            if (pages !== layout.pages.length)
                warnings.push(`pdfinfo counts ${pages} pages, pdftotext ${layout.pages.length}`)
            if (
                layout.pages.some(
                    page => Math.abs(page.widthPt - A4.widthPt) > 1 || Math.abs(page.heightPt - A4.heightPt) > 1,
                )
            )
                warnings.push('Page size is not A4')
            for (const page of pagesWithTextOutside(layout)) warnings.push(`Text outside page ${page}`)
            for (const block of blocks) if (block.lines === null) warnings.push(`Measurement unavailable: ${block.id}`)

            const seconds = (performance.now() - started) / 1000
            this.seconds.observe(seconds)
            const fill = pageFills(layout, assets.geometry)
            this.logger.log(
                {
                    template: request.template,
                    pages,
                    lastPageFill: fill.at(-1) ?? 0,
                    sizeBytes: pdf.length,
                    overfullPt: parsed.overfullPt,
                    fontsOk: fontCheck.ok,
                    blocks: blocks.length,
                    unmeasured: blocks.filter(block => block.lines === null).length,
                    ms: Math.round(seconds * 1000),
                },
                'CV built',
            )
            return {
                pdf,
                pages,
                fill,
                sizeBytes: pdf.length,
                fits: pages <= request.maxPages,
                overfullPt: parsed.overfullPt,
                fontsOk: fontCheck.ok,
                blocks,
                warnings: capWarnings(warnings),
            }
        } finally {
            await rm(dir, {
                recursive: true,
                force: true,
                maxRetries: 3,
            })
        }
    }

    /** Readiness: xelatex and poppler run; the result is cached for 30 s. */
    private async toolchain() {
        const now = Date.now()
        if (!this.probe || now - this.probe.at > PROBE_CACHE_MS)
            this.probe = {
                at: now,
                problem: await this.runProbe(),
            }
        if (this.probe.problem) throw new Error(this.probe.problem)
    }

    private async runProbe(): Promise<string | null> {
        for (const [command, args] of TOOLS) {
            const result = await this.tools.run(command, args, {
                cwd: this.config.workDir,
                timeoutMs: PROBE_TIMEOUT_MS,
            })
            if (result.code !== 0 || result.timedOut)
                return `${command} ${result.timedOut ? 'timed out' : 'is not runnable'}`
        }
        return null
    }
}

/** The template's font folder as `fonts/` of the build folder: a link, or a copy where links fail. */
async function linkFonts(source: string, target: string) {
    try {
        await symlink(source, target, 'dir')
    } catch {
        await cp(source, target, {
            recursive: true,
        })
    }
}

function capWarnings(warnings: string[]) {
    if (warnings.length <= MAX_WARNINGS) return warnings
    const kept = warnings.slice(0, MAX_WARNINGS - 1)
    kept.push(`${warnings.length - kept.length} more warnings not shown`)
    return kept
}
