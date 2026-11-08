import { tmpdir } from 'node:os'
import { registerAs } from '@nestjs/config'
import { env } from './env.js'

/** Service name: logs, metrics. */
export const SERVICE_NAME = 'tailor-tex'

export const appConfig = registerAs('app', () => ({
    service: SERVICE_NAME,
    nodeEnv: env().NODE_ENV,
    production: env().NODE_ENV === 'production',
    port: env().PORT,
    version: env().APP_VERSION,
    logLevel: env().LOG_LEVEL,
    trustProxyHops: env().TRUST_PROXY_HOPS,
    shutdownDelayMs: env().SHUTDOWN_DELAY_MS,
    metricsPort: env().METRICS_PORT,
}))

export const authConfig = registerAs('auth', () => ({
    internalToken: env().INTERNAL_API_TOKEN,
}))

export const texConfig = registerAs('tex', () => ({
    concurrency: env().TEX_CONCURRENCY,
    queueMax: env().TEX_QUEUE_MAX,
    timeoutMs: env().TEX_TIMEOUT_MS,
    workDir: env().TEX_WORK_DIR ?? tmpdir(),
}))
export type TexConfig = ReturnType<typeof texConfig>
