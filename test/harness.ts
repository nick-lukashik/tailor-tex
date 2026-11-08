import { spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { Logger } from 'nestjs-pino'
import request from 'supertest'
import { configureApp } from '../src/app.setup.js'
import { Metrics } from '../src/common/metrics/metrics.js'
import { env } from '../src/config/env.js'
import { TOOL_RUNNER, type ToolOptions, type ToolResult, type ToolRunner } from '../src/cv/tools.js'

export type TestApp = Awaited<ReturnType<typeof startApp>>

export const TOKEN = 't'.repeat(40)

/** xelatex and poppler on PATH: the real TeX tests run only then. */
export const hasTex = [
    'xelatex',
    'pdftotext',
    'pdfinfo',
    'pdffonts',
].every(
    tool =>
        spawnSync(
            tool,
            [
                tool === 'xelatex' ? '-version' : '-v',
            ],
            {
                stdio: 'ignore',
            },
        ).status === 0,
)

export const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url)

/**
 * Stands in for xelatex and poppler: writes what they would and answers with
 * the recorded alexExample build. `failCompile` makes xelatex stop on an
 * error, `timeOut` reports a killed run, `pages` is what pdfinfo prints, and
 * `hold` keeps xelatex running until released.
 */
export class FakeTools implements ToolRunner {
    calls: string[] = []
    failCompile = false
    timeOut = false
    broken = false
    pages = 1
    hold: Promise<void> | null = null

    reset() {
        this.calls = []
        this.failCompile = false
        this.timeOut = false
        this.broken = false
        this.pages = 1
        this.hold = null
    }

    async run(command: string, args: string[], { cwd }: ToolOptions): Promise<ToolResult> {
        this.calls.push(command)
        const ok = {
            code: 0,
            output: '',
            timedOut: false,
        }
        if (this.broken)
            return {
                code: null,
                output: 'spawn ENOENT',
                timedOut: false,
            }
        switch (command) {
            case 'xelatex':
                if (args[0] === '-version') return ok
                if (this.hold) await this.hold
                if (this.timeOut)
                    return {
                        code: null,
                        output: '',
                        timedOut: true,
                    }
                if (this.failCompile) {
                    await writeFile(
                        join(cwd, 'cv.log'),
                        "(./content.tex\n! Undefined control sequence.\nl.27 \\oops\n\nHere is how much of TeX's memory you used:\n",
                    )
                    return {
                        ...ok,
                        code: 1,
                    }
                }
                await writeFile(join(cwd, 'cv.pdf'), '%PDF-1.5 fake')
                await writeFile(join(cwd, 'cv.log'), 'Overfull \\hbox (1.5pt too wide) in paragraph at lines 3--4\n')
                return ok
            case 'pdfinfo':
                return {
                    ...ok,
                    output: `Pages:           ${this.pages}\n`,
                }
            case 'pdffonts':
                return {
                    ...ok,
                    output: await readFile(fixture('alex.pdffonts.txt'), 'utf8'),
                }
            case 'pdftotext':
                if (args[0] === '-bbox-layout') await copyFile(fixture('alex.bbox.xhtml'), args[2] as string)
                return ok
            default:
                return ok
        }
    }
}

/**
 * The real AppModule on a random port, with its own build folder. With
 * `tools` the TeX toolchain is replaced by that fake; without, xelatex and
 * poppler from PATH run.
 */
export async function startApp(options: { tools?: ToolRunner; env?: Record<string, string> } = {}) {
    const workDir = await mkdtemp(join(tmpdir(), 'tailor-tex-test-'))
    Object.assign(process.env, {
        NODE_ENV: 'test',
        LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
        APP_VERSION: 'test',
        METRICS_PORT: '0',
        INTERNAL_API_TOKEN: TOKEN,
        TEX_CONCURRENCY: '2',
        TEX_QUEUE_MAX: '0',
        TEX_TIMEOUT_MS: '45000',
        TEX_WORK_DIR: workDir,
        ...options.env,
    })
    env.reset()

    const { AppModule } = await import('../src/app.module.js')
    let builder = Test.createTestingModule({
        imports: [
            AppModule,
        ],
    })
    if (options.tools) builder = builder.overrideProvider(TOOL_RUNNER).useValue(options.tools)
    const moduleRef = await builder.compile()
    const app = moduleRef.createNestApplication<NestExpressApplication>({
        bufferLogs: true,
    })
    app.useLogger(app.get(Logger))
    configureApp(app)
    await app.init()
    await app.listen(0, '127.0.0.1')
    const { registry } = app.get(Metrics)

    return {
        app,
        workDir,
        http: () => request(app.getHttpServer()),
        /** POST with the service token. */
        post: (path: string, body: unknown) =>
            request(app.getHttpServer())
                .post(path)
                .set('authorization', `Bearer ${TOKEN}`)
                .send(body as object),
        /** Sum of a metric's series that carry `labels` (0 when none). */
        metric: async (name: string, labels: Record<string, string> = {}) => {
            const metric = registry.getSingleMetric(name)
            if (!metric) throw new Error(`no metric ${name}`)
            const { values } = await metric.get()
            return values
                .filter(value => Object.entries(labels).every(([key, label]) => value.labels[key] === label))
                .reduce((sum, value) => sum + value.value, 0)
        },
        close: async () => {
            await app.close()
            await rm(workDir, {
                recursive: true,
                force: true,
            })
        },
    }
}
