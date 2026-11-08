import { Body, Controller, HttpCode, HttpStatus, Post, Res, StreamableFile, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { InternalTokenGuard } from '../auth/internal-token.guard.js'
import { AppError } from '../common/http/app-error.js'
import { ApiErrors } from '../common/openapi/openapi.js'
import { type CvBuildRequest, type CvMeasurement, cvBuildRequestSchema, cvMeasurementSchema } from './cv.schemas.js'
import { CvService } from './cv.service.js'

/**
 * Internal only (Tailor's API calls it inside the cluster with this
 * service's INTERNAL_API_TOKEN). `measure` is for the fitting loop, `render`
 * for the final PDF.
 */
@ApiTags('cv')
@ApiBearerAuth()
@UseGuards(InternalTokenGuard)
@Controller('cv')
export class CvController {
    constructor(private readonly cv: CvService) {}

    @Post('render')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Build the CV and return the PDF',
        description:
            'Headers: x-pdf-pages (page count), x-pdf-fill (fill of the last page, 0..1). More pages than maxPages is a 422.',
    })
    @ApiProduces('application/pdf')
    @ApiOkResponse({
        description: 'The PDF',
        content: {
            'application/pdf': {
                schema: {
                    type: 'string',
                    format: 'binary',
                },
            },
        },
        headers: {
            'x-pdf-pages': {
                description: 'Page count',
                schema: {
                    type: 'integer',
                },
            },
            'x-pdf-fill': {
                description: 'Fill of the last page text area, 0 to 1',
                schema: {
                    type: 'number',
                },
            },
        },
    })
    @ApiErrors(400, 401, 413, 422, 429)
    async render(
        @Body({
            schema: cvBuildRequestSchema,
        })
        body: CvBuildRequest,
        @Res({
            passthrough: true,
        })
        res: Response,
    ) {
        const build = await this.cv.build(body)
        if (!build.fits)
            throw new AppError('UNPROCESSABLE', `PDF has ${build.pages} pages, more than maxPages ${body.maxPages}`, [
                {
                    path: 'maxPages',
                    message: `${build.pages} pages`,
                },
            ])
        res.setHeader('x-pdf-pages', String(build.pages))
        res.setHeader('x-pdf-fill', String(build.fill.at(-1) ?? 0))
        return new StreamableFile(build.pdf, {
            type: 'application/pdf',
            length: build.pdf.length,
            disposition: 'inline; filename="cv.pdf"',
        })
    }

    @Post('measure')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Build the CV and return its measurements, without the PDF',
    })
    @ApiOkResponse({
        standardSchema: cvMeasurementSchema,
    })
    @ApiErrors(400, 401, 413, 422, 429)
    async measure(
        @Body({
            schema: cvBuildRequestSchema,
        })
        body: CvBuildRequest,
    ): Promise<CvMeasurement> {
        const { pdf: _pdf, ...measurement } = await this.cv.build(body)
        return measurement
    }
}
