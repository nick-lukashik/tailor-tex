import { createHash, timingSafeEqual } from 'node:crypto'
import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { authConfig } from '../config/config.js'

const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/

/** The token of an `Authorization: Bearer <token>` header, or undefined. */
export function bearerToken(header: string | string[] | undefined): string | undefined {
    if (typeof header !== 'string' || header.length > 8_192) return undefined
    return BEARER.exec(header)?.[1]
}

/** Constant time: both sides are hashed first, so neither length nor a common prefix leaks. */
export function secretMatches(presented: string | undefined, expected: string): boolean {
    if (!presented || !expected) return false
    const digest = (value: string) => createHash('sha256').update(value).digest()
    return timingSafeEqual(digest(presented), digest(expected))
}

/**
 * In-cluster calls: `Authorization: Bearer <INTERNAL_API_TOKEN>`, the same
 * scheme as `@Internal()` of `@nick-lukashik/auth/nest` (identity.md, "Service
 * to service"). The NetworkPolicy admits only api-client pods; this is the
 * second lock.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
    constructor(@Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<{
            headers: Record<string, string | string[] | undefined>
        }>()
        if (!secretMatches(bearerToken(request.headers.authorization), this.auth.internalToken)) {
            throw new UnauthorizedException('Service token required')
        }
        return true
    }
}
