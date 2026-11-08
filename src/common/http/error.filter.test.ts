import { BadRequestException, HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { AppError, notFound } from './app-error.js'
import { renderError } from './error.filter.js'

describe('renderError', () => {
    it('keeps code, message and details of an AppError', () => {
        const error = new AppError('VALIDATION_FAILED', 'Request validation failed', [
            {
                path: 'title',
                message: 'Required',
            },
        ])
        expect(renderError(error)).toEqual({
            status: 400,
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed',
            details: [
                {
                    path: 'title',
                    message: 'Required',
                },
            ],
        })
        expect(renderError(notFound('Template'))).toEqual({
            status: 404,
            code: 'NOT_FOUND',
            message: 'Template not found',
        })
    })

    it('maps any 429 (the throttler) to RATE_LIMITED', () => {
        expect(renderError(new HttpException('ThrottlerException: Too Many Requests', 429))).toEqual({
            status: 429,
            code: 'RATE_LIMITED',
            message: 'Too many requests',
        })
    })

    it('maps Nest HTTP exceptions by status', () => {
        expect(renderError(new NotFoundException('Cannot GET /x'))).toEqual({
            status: 404,
            code: 'NOT_FOUND',
            message: 'Cannot GET /x',
        })
        expect(renderError(new BadRequestException('Unexpected token'))).toMatchObject({
            status: 400,
            code: 'VALIDATION_FAILED',
        })
    })

    it('keeps the status of a body-parser refusal', () => {
        const tooLarge = Object.assign(new Error('request entity too large'), {
            expose: true,
            status: 413,
            type: 'entity.too.large',
        })
        expect(renderError(tooLarge)).toEqual({
            status: 413,
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Request body too large',
        })
    })

    it('maps a missing service token to UNAUTHORIZED', () => {
        expect(renderError(new UnauthorizedException('Service token required'))).toEqual({
            status: 401,
            code: 'UNAUTHORIZED',
            message: 'Service token required',
        })
    })

    it('keeps 422 UNPROCESSABLE with its details', () => {
        expect(
            renderError(
                new AppError('UNPROCESSABLE', 'xelatex failed (exit 1)', [
                    {
                        path: 'log',
                        message: '! Undefined control sequence.',
                    },
                ]),
            ),
        ).toMatchObject({
            status: 422,
            code: 'UNPROCESSABLE',
            details: [
                {
                    path: 'log',
                },
            ],
        })
    })

    it('keeps 504 TIMEOUT of the request budget', () => {
        expect(renderError(new AppError('TIMEOUT', 'Request timed out'))).toEqual({
            status: 504,
            code: 'TIMEOUT',
            message: 'Request timed out',
        })
    })

    it('never leaks the message of an unknown error', () => {
        const rendered = renderError(new Error('password=secret in connection string'))
        expect(rendered).toEqual({
            status: 500,
            code: 'INTERNAL',
            message: 'Internal server error',
        })
    })
})
