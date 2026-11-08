import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CvDocument, cvMeasurementSchema } from '../src/cv/cv.schemas.js'
import { alexExample, jordanSample } from './fixtures/cv.js'
import { hasTex, startApp, type TestApp } from './harness.js'

/**
 * Real XeLaTeX and poppler through the whole app. Skipped when xelatex,
 * pdftotext, pdfinfo or pdffonts is not on PATH (the org CI runner and a Mac
 * without TeX Live); the Docker image has them (README, "Tests").
 */
describe.skipIf(!hasTex)('XeLaTeX builds (needs xelatex and poppler on PATH)', () => {
    let t: TestApp

    beforeAll(async () => {
        t = await startApp()
    })
    afterAll(async () => {
        await t?.close()
    })

    const measure = async (document: CvDocument) => {
        const res = await t.post('/api/v1/cv/measure', {
            document,
        })
        expect(res.status).toBe(200)
        return cvMeasurementSchema.parse(res.body)
    }

    it('is ready with the real toolchain', async () => {
        const res = await t.http().get('/health/ready')
        expect(res.status).toBe(200)
    })

    it('builds the two-page sample within two pages, fonts embedded, every block measured', async () => {
        const result = await measure(jordanSample)
        expect(result.pages).toBe(2)
        expect(result.fits).toBe(true)
        expect(result.fontsOk).toBe(true)
        expect(result.overfullPt).toBeLessThanOrEqual(2)
        expect(result.fill).toHaveLength(2)
        expect(result.fill[1]).toBeGreaterThan(0)
        expect(result.fill[1]).toBeLessThan(1)
        const bullets = jordanSample.jobs.flatMap(job => job.bullets)
        expect(result.blocks).toHaveLength(jordanSample.summary.length + jordanSample.skills.length + bullets.length)
        for (const block of result.blocks) expect(block.lines, block.id).toBeGreaterThan(0)
        expect(result.warnings.filter(w => w.startsWith('Measurement unavailable'))).toEqual([])
    })

    it('builds every special character on one page without warnings', async () => {
        const result = await measure(alexExample)
        expect(result).toMatchObject({
            pages: 1,
            fontsOk: true,
            warnings: [],
        })
        expect(result.blocks.every(block => (block.lines ?? 0) > 0)).toBe(true)
    })

    it('prints an injection attempt as text instead of running it', async () => {
        const attack = '\\input{/etc/hostname} \\immediate\\write18{id} }\\end{document}'
        const res = await t.post('/api/v1/cv/measure', {
            document: {
                ...alexExample,
                summary: [
                    attack,
                ],
            },
        })
        expect(res.status).toBe(200)
        expect(res.body.blocks[0]).toEqual({
            id: 'summary:0',
            lines: 1,
        })
    })

    const render = (document: CvDocument) =>
        t
            .post('/api/v1/cv/render', {
                document,
            })
            .buffer(true)
            .parse((stream, done) => {
                const chunks: Buffer[] = []
                stream.on('data', (chunk: Buffer) => chunks.push(chunk))
                stream.on('end', () => done(null, Buffer.concat(chunks)))
            })

    /** The first page as poppler extracts it, layout kept. */
    const firstPageText = async (pdf: Buffer) => {
        const dir = await mkdtemp(join(tmpdir(), 'cv-'))
        try {
            const file = join(dir, 'cv.pdf')
            await writeFile(file, pdf)
            const { stdout } = await promisify(execFile)('pdftotext', [
                '-layout',
                '-l',
                '1',
                file,
                '-',
            ])
            return stdout
        } finally {
            await rm(dir, {
                recursive: true,
                force: true,
            })
        }
    }

    it('renders a PDF with its headers', async () => {
        const res = await render(jordanSample)
        expect(res.status).toBe(200)
        expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
        expect(res.headers['x-pdf-pages']).toBe('2')
        expect(Number(res.headers['x-pdf-fill'])).toBeGreaterThan(0)
    })

    it('fits a row of links too wide at full size on one line', async () => {
        const links = [
            'jordan.sample@example.com',
            'in.example.com/jordan-sample',
            'git.example.com/jordan',
            'chat.example.com/jordan',
            'jordan.example.com',
        ]
        const res = await render({
            ...jordanSample,
            links: links.map(text => ({
                url: `https://${text}`,
                text,
            })),
        })
        expect(res.status).toBe(200)
        const row = (await firstPageText(res.body as Buffer))
            .split('\n')
            .find(line => line.includes(links[0] as string))
        for (const text of links) expect(row).toContain(text)
    })

    it('renders the header without location and phone, the title beside the name', async () => {
        const res = await render({
            ...jordanSample,
            location: '',
            phoneDisplay: '',
            phoneDigits: '',
        })
        expect(res.status).toBe(200)
        const lines = (await firstPageText(res.body as Buffer)).split('\n').filter(line => line.trim())
        expect(lines[0]?.trim().startsWith(jordanSample.name)).toBe(true)
        expect(lines[0]).toContain(jordanSample.headline)
        expect(lines.join('\n')).not.toContain(jordanSample.phoneDisplay)
        expect(lines.join('\n')).not.toContain(jordanSample.location)
    })

    it('reports an unbreakable word as overfull', async () => {
        const result = await measure({
            ...alexExample,
            jobs: [
                {
                    ...(alexExample.jobs[0] as CvDocument['jobs'][number]),
                    bullets: [
                        {
                            id: 'long',
                            text: `Built ${'x'.repeat(160)} once.`,
                        },
                    ],
                },
            ],
        })
        expect(result.overfullPt).toBeGreaterThan(10)
        expect(result.warnings.some(w => w.startsWith('Overfull'))).toBe(true)
    })
})
