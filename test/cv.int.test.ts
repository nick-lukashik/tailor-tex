import { readdirSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cvMeasurementSchema } from '../src/cv/cv.schemas.js'
import { alexExample } from './fixtures/cv.js'
import { FakeTools, startApp, type TestApp } from './harness.js'

/** The HTTP contract with a fake toolchain: runs everywhere, CI included. */
describe('POST /api/v1/cv/*', () => {
    const tools = new FakeTools()
    let t: TestApp

    beforeAll(async () => {
        t = await startApp({
            tools,
            env: {
                TEX_CONCURRENCY: '1',
                TEX_QUEUE_MAX: '1',
            },
        })
    })
    afterAll(async () => {
        await t?.close()
    })
    beforeEach(() => tools.reset())

    const pdf = (body: unknown) =>
        t
            .post('/api/v1/cv/render', body)
            .buffer(true)
            .parse((res, done) => {
                const chunks: Buffer[] = []
                res.on('data', (chunk: Buffer) => chunks.push(chunk))
                res.on('end', () => done(null, Buffer.concat(chunks)))
            })

    it('renders the PDF with its page count and last-page fill', async () => {
        const res = await pdf({
            document: alexExample,
        })
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toBe('application/pdf')
        expect(res.headers['x-pdf-pages']).toBe('1')
        expect(Number(res.headers['x-pdf-fill'])).toBeCloseTo(0.587, 2)
        expect((res.body as Buffer).toString()).toBe('%PDF-1.5 fake')
        expect(tools.calls).toEqual([
            'xelatex',
            'xelatex',
            'pdfinfo',
            'pdffonts',
            'pdftotext',
        ])
        expect(readdirSync(t.workDir)).toEqual([])
    })

    it('passes xelatex the hardening flags and no secrets', async () => {
        const seen: {
            args: string[]
            env?: NodeJS.ProcessEnv
        }[] = []
        const run = tools.run.bind(tools)
        tools.run = async (command, args, options) => {
            if (command === 'xelatex')
                seen.push({
                    args,
                    env: options.env,
                })
            return run(command, args, options)
        }
        try {
            await t.post('/api/v1/cv/measure', {
                document: alexExample,
            })
        } finally {
            tools.run = run
        }
        expect(seen[0]?.args).toEqual(
            expect.arrayContaining([
                '-no-shell-escape',
                '-halt-on-error',
                '-interaction=nonstopmode',
            ]),
        )
        expect(seen[0]?.env).toMatchObject({
            openin_any: 'p',
            openout_any: 'p',
        })
        expect(seen[0]?.env).not.toHaveProperty('INTERNAL_API_TOKEN')
    })

    it('measures without the PDF', async () => {
        const res = await t.post('/api/v1/cv/measure', {
            document: alexExample,
            maxPages: 1,
        })
        expect(res.status).toBe(200)
        const body = cvMeasurementSchema.parse(res.body)
        expect(body).toMatchObject({
            pages: 1,
            sizeBytes: 13,
            fits: true,
            overfullPt: 1.5,
            fontsOk: true,
            warnings: [
                'Overfull \\hbox (1.5pt too wide) in paragraph at lines 3--4',
            ],
        })
        expect(body.fill).toHaveLength(1)
        expect(body.fill[0]).toBeCloseTo(0.587, 2)
        expect(body.blocks.map(block => block.id)).toEqual([
            'summary:0',
            'summary:1',
            'skill:0',
            'skill:1',
            'skill:2',
            'skill:3',
            'bullet:nw1',
            'bullet:nw2',
            'bullet:nw3',
        ])
        expect(body.blocks.every(block => (block.lines ?? 0) > 0)).toBe(true)
        expect(res.body).not.toHaveProperty('pdf')
    })

    it('refuses to render more pages than maxPages, measure reports it', async () => {
        tools.pages = 3
        const render = await t.post('/api/v1/cv/render', {
            document: alexExample,
        })
        expect(render.status).toBe(422)
        expect(render.body).toMatchObject({
            code: 'UNPROCESSABLE',
            message: 'PDF has 3 pages, more than maxPages 2',
        })
        tools.pages = 3
        const measure = await t.post('/api/v1/cv/measure', {
            document: alexExample,
        })
        expect(measure.status).toBe(200)
        expect(measure.body).toMatchObject({
            pages: 3,
            fits: false,
        })
    })

    it('answers 422 with the log tail when TeX fails', async () => {
        tools.failCompile = true
        const res = await t.post('/api/v1/cv/render', {
            document: alexExample,
        })
        expect(res.status).toBe(422)
        expect(res.body).toEqual({
            code: 'UNPROCESSABLE',
            message: 'xelatex failed (exit 1)',
            details: [
                {
                    path: 'log',
                    message: '! Undefined control sequence.',
                },
                {
                    path: 'log',
                    message: 'l.27 \\oops',
                },
                {
                    path: 'log',
                    message: '',
                },
            ],
            requestId: res.headers['x-request-id'],
        })
        expect(tools.calls).toEqual([
            'xelatex',
        ])
        expect(readdirSync(t.workDir)).toEqual([])
    })

    it('answers 500, not 422, when xelatex is killed or missing', async () => {
        tools.broken = true
        const res = await t.post('/api/v1/cv/render', {
            document: alexExample,
        })
        expect(res.status).toBe(500)
        expect(res.body).toMatchObject({
            code: 'INTERNAL',
            message: 'Internal server error',
        })
        expect(
            await t.metric('tailor_tex_builds_total', {
                outcome: 'failed',
            }),
        ).toBe(1)
        expect(readdirSync(t.workDir)).toEqual([])
    })

    it('answers 504 when the build runs out of time', async () => {
        tools.timeOut = true
        const res = await t.post('/api/v1/cv/measure', {
            document: alexExample,
        })
        expect(res.status).toBe(504)
        expect(res.body).toMatchObject({
            code: 'TIMEOUT',
            message: 'TeX build timed out after 45 s',
        })
        expect(
            await t.metric('tailor_tex_builds_total', {
                outcome: 'timeout',
            }),
        ).toBe(1)
        expect(readdirSync(t.workDir)).toEqual([])
    })

    it('queues one build and answers 429 while the slot and the queue are taken', async () => {
        let release = () => {}
        tools.hold = new Promise<void>(resolve => {
            release = resolve
        })
        const first = t
            .post('/api/v1/cv/measure', {
                document: alexExample,
            })
            .then(res => res.status)
        await expect.poll(() => tools.calls.length).toBe(1)
        const second = t
            .post('/api/v1/cv/measure', {
                document: alexExample,
            })
            .then(res => res.status)
        await expect
            .poll(() =>
                t.metric('tailor_tex_slots', {
                    state: 'waiting',
                }),
            )
            .toBe(1)
        const third = await t.post('/api/v1/cv/measure', {
            document: alexExample,
        })
        expect(third.status).toBe(429)
        expect(third.body).toMatchObject({
            code: 'RATE_LIMITED',
            message: 'All TeX build slots are busy, retry later',
        })
        release()
        expect(
            await Promise.all([
                first,
                second,
            ]),
        ).toEqual([
            200,
            200,
        ])
    })

    it('refuses a missing or wrong token before any build', async () => {
        for (const authorization of [
            undefined,
            `Bearer ${'x'.repeat(40)}`,
        ]) {
            const req = t.http().post('/api/v1/cv/render')
            if (authorization) req.set('authorization', authorization)
            const res = await req.send({
                document: alexExample,
            })
            expect(res.status).toBe(401)
            expect(res.body).toMatchObject({
                code: 'UNAUTHORIZED',
                message: 'Service token required',
            })
        }
        expect(tools.calls).toEqual([])
    })

    it('validates the request with every failing field', async () => {
        const res = await t.post('/api/v1/cv/render', {
            document: {
                ...alexExample,
                jobs: [],
            },
            template: 'comic',
            maxPages: 0,
        })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('VALIDATION_FAILED')
        expect(res.body.details.map((detail: { path: string }) => detail.path).sort()).toEqual([
            'document.jobs',
            'maxPages',
            'template',
        ])
        expect(tools.calls).toEqual([])
    })
})
