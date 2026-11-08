import { applyDecorators, type INestApplication } from '@nestjs/common'
import { ApiResponse, DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { errorBodySchema } from '../http/app-error.js'

const descriptions: Record<number, string> = {
    400: 'Validation failed (VALIDATION_FAILED)',
    401: 'No valid service token (UNAUTHORIZED)',
    404: 'Not found (NOT_FOUND)',
    413: 'Request body over 1 MiB (PAYLOAD_TOO_LARGE)',
    422: 'TeX failed (log tail in details) or more pages than maxPages (UNPROCESSABLE)',
    429: 'Every TeX build slot is busy, retry later (RATE_LIMITED)',
    500: 'Internal error (INTERNAL)',
    504: 'TeX build over 45 s or request over 60 s (TIMEOUT)',
}

/** Documents the contract error body for the given statuses; 500 and 504 apply to every route. */
export const ApiErrors = (...statuses: (400 | 401 | 404 | 413 | 422 | 429)[]) =>
    applyDecorators(
        ...[
            ...statuses,
            500 as const,
            504 as const,
        ].map(status =>
            ApiResponse({
                status,
                description: descriptions[status],
                standardSchema: errorBodySchema,
            }),
        ),
    )

/**
 * OpenAPI generated from the Zod schemas on the routes: JSON at
 * `/openapi.json` always, Swagger UI at `/docs` only when `ui` is true.
 */
export function setupOpenApi(
    app: INestApplication,
    options: {
        title: string
        version: string
        ui: boolean
    },
) {
    const config = new DocumentBuilder().setTitle(options.title).setVersion(options.version).addBearerAuth().build()
    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup('docs', app, document, {
        ui: options.ui,
        raw: [
            'json',
        ],
        jsonDocumentUrl: 'openapi.json',
    })
    return document
}
