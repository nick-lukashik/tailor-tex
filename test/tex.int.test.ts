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

    it('renders a PDF with its headers', async () => {
        const res = await t
            .post('/api/v1/cv/render', {
                document: jordanSample,
            })
            .buffer(true)
            .parse((stream, done) => {
                const chunks: Buffer[] = []
                stream.on('data', (chunk: Buffer) => chunks.push(chunk))
                stream.on('end', () => done(null, Buffer.concat(chunks)))
            })
        expect(res.status).toBe(200)
        expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
        expect(res.headers['x-pdf-pages']).toBe('2')
        expect(Number(res.headers['x-pdf-fill'])).toBeGreaterThan(0)
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
