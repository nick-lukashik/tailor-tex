import type { PageGeometry } from './assets.js'
import type { MeasuredBlock } from './content.js'

/**
 * Reading the compiled CV back: poppler's word boxes (`pdftotext
 * -bbox-layout`), `pdfinfo`, `pdffonts` and the XeLaTeX log. Parses only
 * poppler's own generated XHTML, never external XML.
 */

type Box = {
    xMin: number
    yMin: number
    xMax: number
    yMax: number
}
export type BboxWord = Box & {
    page: number
    row: number
    text: string
}
export type BboxLayout = {
    pages: {
        widthPt: number
        heightPt: number
    }[]
    words: BboxWord[]
}

/** Rows of a page closer than this (pt) are one printed line; body leading is 13 pt. */
const ROW_TOLERANCE_PT = 2

const ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
}
const decode = (value: string) =>
    value.replace(
        /&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi,
        (_, numeric: string | undefined, named: string | undefined) =>
            numeric
                ? String.fromCodePoint(
                      numeric.startsWith('x') ? Number.parseInt(numeric.slice(1), 16) : Number.parseInt(numeric, 10),
                  )
                : (ENTITIES[(named ?? '').toLowerCase()] ?? ''),
    )

/** Letters and digits only, lower case: what survives any line break or ligature. */
export const normalized = (text: string) =>
    text
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '')

function attrs(source: string) {
    const result: Record<string, number> = {}
    for (const match of source.matchAll(/\b(width|height|xMin|yMin|xMax|yMax)="([\d.eE+-]+)"/g))
        result[match[1] as string] = Number(match[2])
    return result
}

function box(source: string, what: string): Box {
    const { xMin, yMin, xMax, yMax } = attrs(source)
    if (
        xMin === undefined
        || yMin === undefined
        || xMax === undefined
        || yMax === undefined
        || ![
            xMin,
            yMin,
            xMax,
            yMax,
        ].every(Number.isFinite)
        || xMax < xMin
        || yMax < yMin
    )
        throw new Error(`Invalid poppler ${what} bounds`)
    return {
        xMin,
        yMin,
        xMax,
        yMax,
    }
}

/**
 * Words in reading order, each with its page and printed row. Poppler may
 * split one printed line into several `<line>`s (a gap, a font change); rows
 * group them by baseline.
 */
export function parseBbox(xhtml: string): BboxLayout {
    const pages: BboxLayout['pages'] = []
    const words: BboxWord[] = []
    let rowBase = 0
    for (const page of xhtml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)) {
        const { width, height } = attrs(page[1] ?? '')
        if (!(width && width > 0 && height && height > 0)) throw new Error('Invalid poppler page size')
        pages.push({
            widthPt: width,
            heightPt: height,
        })
        const lines = [
            ...(page[2] ?? '').matchAll(/<line\b([^>]*)>([\s\S]*?)<\/line>/g),
        ].map(line => ({
            box: box(line[1] ?? '', 'line'),
            body: line[2] ?? '',
        }))
        // Baselines of the page, top to bottom, clustered into rows.
        const baselines = [
            ...new Set(lines.map(line => line.box.yMax)),
        ].sort((a, b) => a - b)
        const rowOf = new Map<number, number>()
        let row = rowBase - 1
        let start = Number.NEGATIVE_INFINITY
        for (const y of baselines) {
            if (y - start > ROW_TOLERANCE_PT) {
                row++
                start = y
            }
            rowOf.set(y, row)
        }
        rowBase = row + 1
        for (const line of lines)
            for (const word of line.body.matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g))
                words.push({
                    ...box(word[1] ?? '', 'word'),
                    page: pages.length,
                    row: rowOf.get(line.box.yMax) ?? 0,
                    text: decode(word[2] ?? ''),
                })
    }
    if (!pages.length) throw new Error('Missing poppler pages')
    return {
        pages,
        words,
    }
}

/**
 * Printed lines of each block: its text, letters and digits only, must occur
 * exactly once in the page text and start and end on word edges; `null` when
 * it cannot be found that way.
 */
export function measureBlocks(
    layout: BboxLayout,
    blocks: MeasuredBlock[],
): {
    id: string
    lines: number | null
}[] {
    let flattened = ''
    const positions: BboxWord[] = []
    for (const word of layout.words) {
        const text = normalized(word.text)
        flattened += text
        for (let i = 0; i < text.length; i++) positions.push(word)
    }
    return blocks.map(block => {
        const needle = normalized(block.text)
        const start = needle ? flattened.indexOf(needle) : -1
        const end = start + needle.length
        if (
            start < 0
            || flattened.indexOf(needle, start + 1) >= 0
            // Inside a word, e.g. "API" in "capital".
            || (start > 0 && positions[start] === positions[start - 1])
            || (end < positions.length && positions[end - 1] === positions[end])
        )
            return {
                id: block.id,
                lines: null,
            }
        const rows = new Set(positions.slice(start, end).map(word => `${word.page}:${word.row}`))
        return {
            id: block.id,
            lines: rows.size,
        }
    })
}

/**
 * How far down the text area of each page its last printed line ends, 0
 * (empty) to 1 (full), rounded to 0.001.
 */
export function pageFills(layout: BboxLayout, geometry: PageGeometry): number[] {
    const usable = geometry.heightPt - geometry.topPt - geometry.bottomPt
    return layout.pages.map((_, index) => {
        const bottoms = layout.words.filter(word => word.page === index + 1).map(word => word.yMax)
        if (!bottoms.length) return 0
        const fill = (Math.max(...bottoms) - geometry.topPt) / usable
        return Math.round(Math.min(1, Math.max(0, fill)) * 1000) / 1000
    })
}

/** Fill of the last page (see `pageFills`). */
export function lastPageFill(layout: BboxLayout, geometry: PageGeometry) {
    return pageFills(layout, geometry).at(-1) ?? 0
}

/** Words outside the page box (a run into the margin goes unnoticed otherwise). */
export function pagesWithTextOutside(layout: BboxLayout) {
    const pages = new Set<number>()
    for (const word of layout.words) {
        const size = layout.pages[word.page - 1]
        if (size && (word.xMin < 0 || word.yMin < 0 || word.xMax > size.widthPt || word.yMax > size.heightPt))
            pages.add(word.page)
    }
    return [
        ...pages,
    ]
}

export function pdfPages(pdfinfo: string): number {
    const pages = Number(pdfinfo.match(/^Pages:\s+(\d+)/m)?.[1])
    if (!Number.isInteger(pages)) throw new Error('pdfinfo printed no page count')
    return pages
}

/**
 * `pdffonts`: every face of the family is embedded and nothing else is in
 * the PDF (no fallback such as Latin Modern for a missing glyph).
 */
export function checkFonts(pdffonts: string, required: string[]) {
    const problems: string[] = []
    const found = new Set<string>()
    const rows = pdffonts
        .split(/\r?\n/)
        .slice(2)
        .filter(row => row.trim())
    for (const row of rows) {
        const match = row.match(/^(\S+)\s.*?\s(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/)
        if (!match) {
            problems.push(`Unreadable pdffonts row: ${row.trim().slice(0, 120)}`)
            continue
        }
        const name = (match[1] as string).replace(/^[A-Z]{6}\+/, '')
        if (!required.includes(name)) problems.push(`Fallback font in PDF: ${name}`)
        else if (match[2] !== 'yes') problems.push(`Font not embedded: ${name}`)
        else found.add(name)
    }
    for (const name of required) if (!found.has(name)) problems.push(`Font missing from PDF: ${name}`)
    return {
        ok: problems.length === 0,
        problems,
    }
}

/** Package warnings the template always produces, about nothing on the page. */
const BENIGN = [
    /^Package microtype Warning: Unknown slot number of character/,
]

/** Widest overfull box, and the warnings worth showing (deduplicated). */
export function parseLog(log: string) {
    let overfullPt = 0
    for (const match of log.matchAll(/Overfull \\hbox \(([\d.]+)pt too wide\)/g))
        overfullPt = Math.max(overfullPt, Number(match[1]))
    const warnings = new Set<string>()
    for (const match of log.matchAll(
        /^(?:(?:Overfull|Underfull) \\[hv]box[^\n]*|LaTeX(?: Font)? Warning:[^\n]*|Package (\S+) Warning:[^\n]*(?:\r?\n\(\1\)[^\n]*)*|Missing character:[^\n]*)/gm,
    )) {
        // A package continues its warning on lines starting with `(name)`.
        const text = match[0]
            .replace(/\r?\n\(\S+\)\s*/g, ' ')
            .replace(
                /^Missing character: There is no (.+?) in font \[?(?:[^\]]*\/)?([^\]/:]+)\]?.*$/,
                'Missing character: $1 in $2',
            )
            .trim()
        if (!BENIGN.some(pattern => pattern.test(text))) warnings.add(text.slice(0, 300))
    }
    return {
        overfullPt: Math.round(overfullPt * 100) / 100,
        warnings: [
            ...warnings,
        ],
    }
}

/** What the caller sees of a failed compile: the first error with context, else the end. */
export function logTail(log: string, maxLines = 40): string[] {
    const lines = log.split(/\r?\n/)
    const first = lines.findIndex(line => line.startsWith('!'))
    let picked = first >= 0 ? lines.slice(first, first + 12) : lines.slice(-maxLines)
    // TeX's memory statistics after the error say nothing about it.
    const stats = picked.findIndex(line => line.startsWith('Here is how much'))
    if (first >= 0 && stats > 0) picked = picked.slice(0, stats)
    return picked
        .map(line => line.slice(0, 300))
        .filter((line, index, all) => line.trim() || all[index - 1]?.trim())
        .slice(0, maxLines)
}
