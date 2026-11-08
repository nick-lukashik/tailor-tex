import { UnauthorizedException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { bearerToken, InternalTokenGuard, secretMatches } from './internal-token.guard.js'

const TOKEN = 'a'.repeat(40)
const context = (authorization?: string | string[]) =>
    ({
        switchToHttp: () => ({
            getRequest: () => ({
                headers: {
                    authorization,
                },
            }),
        }),
    }) as never

describe('InternalTokenGuard', () => {
    const guard = new InternalTokenGuard({
        internalToken: TOKEN,
    })

    it('lets the right bearer token through', () => {
        expect(guard.canActivate(context(`Bearer ${TOKEN}`))).toBe(true)
    })

    it('refuses a missing, wrong, malformed or repeated header', () => {
        for (const header of [
            undefined,
            `Bearer ${'b'.repeat(40)}`,
            `Bearer ${TOKEN.slice(1)}`,
            TOKEN,
            `Basic ${TOKEN}`,
            `Bearer ${TOKEN} extra`,
            [
                `Bearer ${TOKEN}`,
            ],
        ])
            expect(() => guard.canActivate(context(header))).toThrow(UnauthorizedException)
    })
})

describe('bearer helpers', () => {
    it('reads only a well-formed bearer header', () => {
        expect(bearerToken('Bearer abc.def-_~+/=')).toBe('abc.def-_~+/=')
        expect(bearerToken(`Bearer ${'x'.repeat(9_000)}`)).toBeUndefined()
    })

    it('never matches an empty secret', () => {
        expect(secretMatches('', '')).toBe(false)
        expect(secretMatches(undefined, TOKEN)).toBe(false)
        expect(secretMatches(TOKEN, TOKEN)).toBe(true)
    })
})
