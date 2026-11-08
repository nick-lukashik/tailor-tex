import { z } from 'zod'
import { baseEnvSchema, defineEnv, metricsEnvSchema } from '../common/config/define-env.js'

/** Every variable this service reads. Nothing else touches process.env. */
export const envSchema = baseEnvSchema.extend(metricsEnvSchema.shape).extend({
    /** Bearer token of the callers inside the cluster (platform service-to-service scheme). */
    INTERNAL_API_TOKEN: z.string().min(32, {
        error: 'at least 32 characters',
    }),
    /** XeLaTeX builds at once in this process; one more is refused with 429 (or waits, see TEX_QUEUE_MAX). */
    TEX_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    /** Builds that may wait for a slot; 0: refuse at once when every slot is busy. */
    TEX_QUEUE_MAX: z.coerce.number().int().min(0).max(16).default(0),
    /** One whole build (two xelatex runs and poppler); below the 60 s request budget. */
    TEX_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(55_000).default(45_000),
    /** Parent of the per-build folders; the OS temp dir (/tmp in the image) by default. */
    TEX_WORK_DIR: z.string().trim().min(1).optional(),
})

export type Env = z.output<typeof envSchema>

export const env = defineEnv(envSchema)
