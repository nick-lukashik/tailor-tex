import { z } from 'zod'

/**
 * The CV as data for the "Minimal violet" template. Bullet and summary text
 * may hold `**…**` spans, printed highlighted; every other character is
 * escaped by the renderer, so callers never send LaTeX.
 */
export const cvDocumentSchema = z
    .strictObject({
        name: z.string().min(1).max(120),
        location: z.string().max(120),
        phoneDisplay: z.string().max(40),
        phoneDigits: z.string().regex(/^\+?\d{6,20}$/, {
            error: 'digits only, optional leading +, 6 to 20 digits',
        }),
        headline: z.string().min(1).max(120),
        stack: z.string().max(160),
        links: z
            .array(
                z.strictObject({
                    url: z.string().min(1).max(300),
                    text: z.string().min(1).max(120),
                }),
            )
            .max(8),
        summary: z.array(z.string().min(1).max(1200)).min(1).max(2),
        skills: z
            .array(
                z.strictObject({
                    label: z.string().min(1).max(60),
                    items: z.array(z.string().min(1).max(80)).min(1).max(40),
                }),
            )
            .min(1)
            .max(14),
        jobs: z
            .array(
                z.strictObject({
                    title: z.string().min(1).max(120),
                    company: z.string().min(1).max(120),
                    dates: z.string().min(1).max(60),
                    location: z.string().max(60),
                    description: z.string().max(200),
                    bullets: z
                        .array(
                            z.strictObject({
                                id: z.string().min(1).max(40),
                                text: z.string().min(1).max(700),
                            }),
                        )
                        .max(20),
                }),
            )
            .min(1)
            .max(10),
        education: z
            .array(
                z.strictObject({
                    degree: z.string().min(1).max(160),
                    school: z.string().min(1).max(160),
                    dates: z.string().max(60),
                }),
            )
            .max(4),
        languages: z
            .array(
                z.strictObject({
                    name: z.string().max(40),
                    level: z.string().max(80),
                }),
            )
            .max(6),
        pdf: z.strictObject({
            title: z.string().max(300),
            subject: z.string().max(500),
            keywords: z.array(z.string().max(80)).max(200),
        }),
    })
    .meta({
        id: 'CvDocument',
    })
export type CvDocument = z.infer<typeof cvDocumentSchema>

export const cvTemplateSchema = z.enum([
    'minimal-violet',
])
export type CvTemplate = z.infer<typeof cvTemplateSchema>

export const cvBuildRequestSchema = z
    .strictObject({
        document: cvDocumentSchema,
        template: cvTemplateSchema.default('minimal-violet'),
        /** render: more pages is a 422; measure: reported as `fits: false`. */
        maxPages: z.int().min(1).max(4).default(2),
    })
    .meta({
        id: 'CvBuildRequest',
    })
export type CvBuildRequest = z.output<typeof cvBuildRequestSchema>

/** What a caller needs to decide whether and what to shorten, without the PDF. */
export const cvMeasurementSchema = z
    .object({
        pages: z.int().min(0),
        /** Fill of each page's text area, 0 (empty) to 1 (full), by pdftotext word boxes. */
        fill: z.array(z.number().min(0).max(1)),
        sizeBytes: z.int().min(0),
        /** pages <= maxPages. */
        fits: z.boolean(),
        /** Widest overfull \hbox in points; 0 when none. */
        overfullPt: z.number().min(0),
        /** Every face of the template's font is embedded, and no fallback font. */
        fontsOk: z.boolean(),
        /** Printed lines of each summary paragraph, skill row and bullet; null when not found. */
        blocks: z.array(
            z.object({
                id: z.string(),
                lines: z.int().min(0).nullable(),
            }),
        ),
        warnings: z.array(z.string()).max(200),
    })
    .meta({
        id: 'CvMeasurement',
    })
export type CvMeasurement = z.infer<typeof cvMeasurementSchema>
