import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Metrics } from '../src/common/metrics/metrics.js'
import { alexExample } from './fixtures/cv.js'
import { FakeTools, startApp, type TestApp } from './harness.js'

describe('health, OpenAPI, metrics, errors', () => {
    const tools = new FakeTools()
    let t: TestApp

    beforeAll(async () => {
        t = await startApp({
            tools,
        })
    })
    afterAll(async () => {
        await t?.close()
    })
    beforeEach(() => tools.reset())

    it('live answers without checking the toolchain', async () => {
        tools.broken = true
        const res = await t.http().get('/health/live')
        expect(res.status).toBe(200)
        expect(res.headers['x-app-version']).toBe('test')
        expect(tools.calls).toEqual([])
    })

    it('ready reports the TeX toolchain and needs no Postgres', async () => {
        const res = await t.http().get('/health/ready')
        expect(res.status).toBe(200)
        expect(res.body.status).toBe('ok')
        expect(Object.keys(res.body.info)).toEqual([
            'tex',
        ])
        expect(tools.calls).toEqual([
            'xelatex',
            'pdfinfo',
            'pdffonts',
            'pdftotext',
        ])
    })

    it('ready keeps the probe result for 30 s instead of spawning on every probe', async () => {
        await t.http().get('/health/ready')
        expect(tools.calls).toEqual([])
    })

    it('serves the OpenAPI document with both routes and the bearer scheme', async () => {
        const res = await t.http().get('/openapi.json')
        expect(res.status).toBe(200)
        expect(Object.keys(res.body.paths)).toEqual(
            expect.arrayContaining([
                '/api/v1/cv/render',
                '/api/v1/cv/measure',
            ]),
        )
        expect(res.body.paths['/api/v1/cv/render'].post.responses['200'].content).toHaveProperty('application/pdf')
        expect(res.body.paths['/api/v1/cv/measure'].post.requestBody.content['application/json'].schema).toEqual({
            $ref: '#/components/schemas/CvBuildRequest',
        })
        expect(res.body.components.schemas.CvMeasurement.required).toEqual(
            expect.arrayContaining([
                'pages',
                'fill',
                'sizeBytes',
            ]),
        )
        expect(res.body.components.securitySchemes).toHaveProperty('bearer')
    })

    it('counts requests by route template and builds by outcome', async () => {
        await t.post('/api/v1/cv/measure', {
            document: alexExample,
        })
        const scrape = await t.app.get(Metrics).scrape()
        expect(scrape).toMatch(
            /http_server_requests_total\{method="POST",route="\/api\/v1\/cv\/measure",status_class="2xx"/,
        )
        expect(
            await t.metric('tailor_tex_builds_total', {
                outcome: 'ok',
            }),
        ).toBeGreaterThanOrEqual(1)
        expect(scrape).toMatch(/tailor_tex_slots\{state="active",service="tailor-tex"\} 0/)
    })

    it('answers unknown routes with the contract body', async () => {
        const res = await t.http().get('/api/v1/unknown')
        expect(res.status).toBe(404)
        expect(res.body.code).toBe('NOT_FOUND')
    })
})

describe('readiness without the toolchain', () => {
    it('answers 503 when xelatex does not run', async () => {
        const tools = new FakeTools()
        tools.broken = true
        const t = await startApp({
            tools,
        })
        try {
            const res = await t.http().get('/health/ready')
            expect(res.status).toBe(503)
            expect(res.body.error.tex).toMatchObject({
                status: 'down',
            })
        } finally {
            await t.close()
        }
    })
})
