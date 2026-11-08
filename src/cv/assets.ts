import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CvTemplate } from './cv.schemas.js'

/** The repo root: the same two levels up from src/cv and dist/cv. */
export const appRoot = fileURLToPath(new URL('../../', import.meta.url))

/** Layout file under templates/ and the font folder under fonts/ of each template. */
export const templates: Record<
    CvTemplate,
    {
        file: string
        fontDir: string
        fontFiles: string[]
    }
> = {
    'minimal-violet': {
        file: 'cv.tex',
        fontDir: 'ibm-plex-sans',
        fontFiles: [
            'IBMPlexSans-Regular.ttf',
            'IBMPlexSans-SemiBold.ttf',
            'IBMPlexSans-Bold.ttf',
        ],
    },
}

/** The text area of the page in PDF points (poppler: origin top left). */
export type PageGeometry = {
    heightPt: number
    topPt: number
    bottomPt: number
}

export type TemplateAssets = {
    source: string
    geometry: PageGeometry
    fontDir: string
    /** What pdffonts prints for each face: every one must be embedded. */
    postScriptNames: string[]
}

const MM = 72 / 25.4
const A4_HEIGHT_PT = 297 * MM

/** Reads top and bottom margins from the template's geometry options. */
export function templateGeometry(template: string): PageGeometry {
    const options = template.match(/\\usepackage\[([^\]]*)\]\{geometry\}/)?.[1]
    const margin = (key: string) => {
        const value = options?.match(new RegExp(`\\b${key}=([\\d.]+)mm`))?.[1]
        if (!value) throw new Error(`template: geometry has no ${key} in mm`)
        return Number(value) * MM
    }
    if (!options?.includes('a4paper')) throw new Error('template: not A4')
    return {
        heightPt: A4_HEIGHT_PT,
        topPt: margin('top'),
        bottomPt: margin('bottom'),
    }
}

/** PostScript name (name id 6) of a TrueType/OpenType font: what pdffonts prints. */
export function postScriptName(font: Buffer): string {
    const tables = font.readUInt16BE(4)
    let offset = -1
    for (let i = 0; i < tables; i++) {
        const record = 12 + i * 16
        if (font.toString('latin1', record, record + 4) === 'name') offset = font.readUInt32BE(record + 8)
    }
    if (offset < 0) throw new Error('Font has no name table')
    const count = font.readUInt16BE(offset + 2)
    const strings = offset + font.readUInt16BE(offset + 4)
    let mac: string | undefined
    for (let i = 0; i < count; i++) {
        const record = offset + 6 + i * 12
        const platform = font.readUInt16BE(record)
        const nameId = font.readUInt16BE(record + 6)
        if (nameId !== 6) continue
        const length = font.readUInt16BE(record + 8)
        const start = strings + font.readUInt16BE(record + 10)
        const raw = font.subarray(start, start + length)
        if (platform === 3 || platform === 0) {
            let name = ''
            for (let j = 0; j + 1 < raw.length; j += 2) name += String.fromCharCode(raw.readUInt16BE(j))
            return name
        }
        if (platform === 1) mac = raw.toString('latin1')
    }
    if (mac) return mac
    throw new Error('Font has no PostScript name')
}

/** Every template with its fonts; fails at startup when a file is missing. */
export async function loadAssets(root = appRoot): Promise<Record<CvTemplate, TemplateAssets>> {
    const result = {} as Record<CvTemplate, TemplateAssets>
    for (const [name, template] of Object.entries(templates) as [
        CvTemplate,
        (typeof templates)[CvTemplate],
    ][]) {
        const source = await readFile(join(root, 'templates', template.file), 'utf8')
        const fontDir = join(root, 'fonts', template.fontDir)
        const postScriptNames = await Promise.all(
            template.fontFiles.map(async file => postScriptName(await readFile(join(fontDir, file)))),
        )
        result[name] = {
            source,
            geometry: templateGeometry(source),
            fontDir,
            postScriptNames,
        }
    }
    return result
}
