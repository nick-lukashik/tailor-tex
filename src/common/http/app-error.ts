import { z } from 'zod'

/** Stable machine-readable error codes of the HTTP contract and their statuses. */
export const errorStatus = {
    VALIDATION_FAILED: 400,
    /** No valid service token (INTERNAL_API_TOKEN). */
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    PAYLOAD_TOO_LARGE: 413,
    /** Valid input that cannot be built: a TeX error, or more pages than allowed. */
    UNPROCESSABLE: 422,
    /** Every TeX build slot is busy; retry later. */
    RATE_LIMITED: 429,
    INTERNAL: 500,
    /** The TeX build or the whole request exceeded its budget. */
    TIMEOUT: 504,
} as const
export type ErrorCode = keyof typeof errorStatus

export type ErrorDetail = {
    path: string
    message: string
}

/** The body of every error response. */
export const errorBodySchema = z
    .object({
        code: z.enum(
            Object.keys(errorStatus) as [
                ErrorCode,
                ...ErrorCode[],
            ],
        ),
        message: z.string(),
        details: z
            .array(
                z.object({
                    path: z.string(),
                    message: z.string(),
                }),
            )
            .optional(),
        requestId: z.string(),
    })
    .meta({
        id: 'Error',
    })
export type ErrorBody = z.infer<typeof errorBodySchema>

/** A domain error with a stable code. Its message goes to clients: no secrets, SQL or stack. */
export class AppError extends Error {
    constructor(
        readonly code: ErrorCode,
        message: string,
        readonly details?: ErrorDetail[],
        options?: {
            cause?: unknown
        },
    ) {
        super(message, options)
        this.name = 'AppError'
    }

    get status(): number {
        return errorStatus[this.code]
    }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`)
