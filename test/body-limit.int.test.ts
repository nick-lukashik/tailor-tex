import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { alexExample } from './fixtures/cv.js'
import { FakeTools, startApp, type TestApp, TOKEN } from './harness.js'

const MiB = 1024 * 1024

/** A JSON build request whose serialized size is exactly `bytes` (an over-long name: invalid), in bytes. */
const requestOfSize = (bytes: number) => {
    const body = (name: string) =>
        JSON.stringify({
            document: {
                ...alexExample,
                name,
            },
        })
    return body('x'.repeat(bytes - Buffer.byteLength(body(''))))
}

describe('request body limit (1 MiB)', () => {
    let t: TestApp
    const tools = new FakeTools()

    beforeAll(async () => {
        t = await startApp({
            tools,
        })
    })
    afterAll(async () => {
        await t?.close()
    })

    const post = (contentType: string, body: string) =>
        t
            .http()
            .post('/api/v1/cv/measure')
            .set('authorization', `Bearer ${TOKEN}`)
            .set('content-type', contentType)
            .send(body)

    it('parses a JSON body of exactly 1 MiB (and then validates it)', async () => {
        const res = await post('application/json', requestOfSize(MiB))
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('VALIDATION_FAILED')
        expect(res.body.details[0].path).toBe('document.name')
    })

    it('answers 413 with the contract body above 1 MiB, for JSON and forms', async () => {
        for (const [contentType, body] of [
            [
                'application/json',
                requestOfSize(MiB + 1),
            ],
            [
                'application/x-www-form-urlencoded',
                `document=${'x'.repeat(MiB)}`,
            ],
        ] as const) {
            const res = await post(contentType, body)
            expect(res.status).toBe(413)
            expect(res.body).toEqual({
                code: 'PAYLOAD_TOO_LARGE',
                message: 'Request body too large',
                requestId: res.headers['x-request-id'],
            })
        }
        expect(tools.calls).toEqual([])
    })

    it('stops reading a chunked body without content-length at the limit', async () => {
        const { port } = t.app.getHttpServer().address() as AddressInfo
        const status = await new Promise<number>((resolve, reject) => {
            const req = request(
                {
                    host: '127.0.0.1',
                    port,
                    method: 'POST',
                    path: '/api/v1/cv/measure',
                    headers: {
                        authorization: `Bearer ${TOKEN}`,
                        'content-type': 'application/json',
                        'transfer-encoding': 'chunked',
                    },
                },
                res => {
                    res.resume()
                    resolve(res.statusCode ?? 0)
                },
            )
            // The server may close the socket while we still write: only the answer matters.
            req.on('error', reject)
            req.write('{"document":{"name":"')
            const chunk = 'x'.repeat(64 * 1024)
            for (let sent = 0; sent < 2 * MiB; sent += chunk.length) req.write(chunk)
            req.end('"}}')
        })
        expect(status).toBe(413)
    })
})
