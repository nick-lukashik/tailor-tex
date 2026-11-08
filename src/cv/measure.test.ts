import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { alexExample } from '../../test/fixtures/cv.js'
import { templateGeometry } from './assets.js'
import { measuredBlocks } from './content.js'
import {
    checkFonts,
    lastPageFill,
    logTail,
    measureBlocks,
    pageFills,
    pagesWithTextOutside,
    parseBbox,
    parseLog,
    pdfPages,
} from './measure.js'

/** Recorded from the alexExample PDF (IBM Plex Sans) in the tailor-tex image: poppler 25.03, xdvipdfmx 20240305. */
const recorded = (name: string) => readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8')
const geometry = templateGeometry(readFileSync(new URL('../../templates/cv.tex', import.meta.url), 'utf8'))

const page = (body: string) => `<page width="595.276" height="841.89"><flow><block>${body}</block></flow></page>`
const line = (words: string[], y: number, x = 10) =>
    `<line xMin="${x}" yMin="${y}" xMax="${x + 40 * words.length}" yMax="${y + 10}">${words
        .map(
            (word, i) =>
                `<word xMin="${x + 40 * i}" yMin="${y}" xMax="${x + 40 * i + 35}" yMax="${y + 10}">${word}</word>`,
        )
        .join('')}</line>`

describe('bbox measurements of a recorded build', () => {
    const layout = parseBbox(recorded('alex.bbox.xhtml'))

    it('finds every block of the CV once and counts its printed lines', () => {
        expect(measureBlocks(layout, measuredBlocks(alexExample))).toEqual([
            {
                id: 'summary:0',
                lines: 1,
            },
            {
                id: 'summary:1',
                lines: 2,
            },
            {
                id: 'skill:0',
                lines: 1,
            },
            {
                id: 'skill:1',
                lines: 1,
            },
            {
                id: 'skill:2',
                lines: 1,
            },
            {
                id: 'skill:3',
                lines: 1,
            },
            {
                id: 'bullet:nw1',
                lines: 1,
            },
            {
                id: 'bullet:nw2',
                lines: 1,
            },
            {
                id: 'bullet:nw3',
                lines: 1,
            },
        ])
    })

    it('reads one A4 page with text inside it', () => {
        expect(layout.pages).toHaveLength(1)
        expect(layout.pages[0]?.widthPt).toBeCloseTo(595.28, 1)
        expect(layout.pages[0]?.heightPt).toBeCloseTo(841.89, 1)
        expect(pagesWithTextOutside(layout)).toEqual([])
    })

    it('puts the last line a bit past the middle of the text area', () => {
        expect(lastPageFill(layout, geometry)).toBeCloseTo(0.587, 2)
        expect(pageFills(layout, geometry)).toEqual([
            lastPageFill(layout, geometry),
        ])
    })

    it('decodes entities and keeps the name first', () => {
        expect(layout.words.slice(0, 2).map(word => word.text)).toEqual([
            'Alex',
            'Example',
        ])
        expect(layout.words.some(word => word.text === 'B2B')).toBe(true)
        expect(layout.words.some(word => word.text.includes('&'))).toBe(true)
    })
})

describe('bbox measurements, edge cases', () => {
    it('counts wrapped lines and decodes entities', () => {
        const layout = parseBbox(
            page(
                line(
                    [
                        'Built',
                        'fast',
                    ],
                    10,
                )
                    + line(
                        [
                            '&amp;',
                            'React-',
                        ],
                        30,
                    )
                    + line(
                        [
                            'based',
                            'APIs.',
                        ],
                        50,
                    ),
            ),
        )
        expect(
            measureBlocks(layout, [
                {
                    id: 'b',
                    text: 'Built fast & React-based APIs.',
                },
            ]),
        ).toEqual([
            {
                id: 'b',
                lines: 3,
            },
        ])
    })

    it('merges poppler lines on one baseline into one printed line', () => {
        const layout = parseBbox(
            page(
                line(
                    [
                        'Built',
                        'a',
                    ],
                    10,
                )
                    + line(
                        [
                            'thing',
                        ],
                        10.4,
                        300,
                    ),
            ),
        )
        expect(
            measureBlocks(layout, [
                {
                    id: 'b',
                    text: 'Built a thing',
                },
            ]),
        ).toEqual([
            {
                id: 'b',
                lines: 1,
            },
        ])
    })

    it('refuses missing, repeated and inside-a-word matches', () => {
        const layout = parseBbox(
            page(
                line(
                    [
                        'Same',
                    ],
                    10,
                )
                    + line(
                        [
                            'Same',
                        ],
                        30,
                    )
                    + line(
                        [
                            'capital',
                        ],
                        50,
                    ),
            ),
        )
        expect(
            measureBlocks(layout, [
                {
                    id: 'same',
                    text: 'Same',
                },
                {
                    id: 'missing',
                    text: 'Missing',
                },
                {
                    id: 'api',
                    text: 'pit',
                },
                {
                    id: 'empty',
                    text: '—',
                },
            ]),
        ).toEqual([
            {
                id: 'same',
                lines: null,
            },
            {
                id: 'missing',
                lines: null,
            },
            {
                id: 'api',
                lines: null,
            },
            {
                id: 'empty',
                lines: null,
            },
        ])
    })

    it('follows a block across a page break and fills each page', () => {
        const layout = parseBbox(
            page(
                line(
                    [
                        'Start',
                        'of',
                    ],
                    800,
                ),
            )
                + page(
                    line(
                        [
                            'the',
                            'end.',
                        ],
                        40,
                    ),
                ),
        )
        expect(
            measureBlocks(layout, [
                {
                    id: 'b',
                    text: 'Start of the end.',
                },
            ]),
        ).toEqual([
            {
                id: 'b',
                lines: 2,
            },
        ])
        const usable = geometry.heightPt - geometry.topPt - geometry.bottomPt
        const fills = pageFills(layout, geometry)
        expect(fills).toHaveLength(2)
        expect(fills[0]).toBeCloseTo(Math.min(1, (810 - geometry.topPt) / usable), 3)
        expect(fills[1]).toBeCloseTo((50 - geometry.topPt) / usable, 3)
        expect(lastPageFill(layout, geometry)).toBe(fills[1])
    })

    it('rejects malformed output', () => {
        expect(() => parseBbox('')).toThrow('Missing poppler pages')
        expect(() => parseBbox('<page width="0" height="2"></page>')).toThrow()
        expect(() =>
            parseBbox(
                page(
                    '<line xMin="1" yMin="1" xMax="2" yMax="2"><word xMin="5" yMin="1" xMax="2" yMax="2">x</word></line>',
                ),
            ),
        ).toThrow('Invalid poppler word bounds')
    })

    it('reports an empty last page as 0 and text past the edge', () => {
        const layout = parseBbox(
            `${page(
                line(
                    [
                        'wide',
                    ],
                    10,
                    580,
                ),
            )}<page width="595" height="842"></page>`,
        )
        expect(lastPageFill(layout, geometry)).toBe(0)
        expect(pagesWithTextOutside(layout)).toEqual([
            1,
        ])
    })
})

describe('pdffonts', () => {
    const fonts = recorded('alex.pdffonts.txt')
    const plex = [
        'IBMPlexSans',
        'IBMPlexSans-SmBld',
        'IBMPlexSans-Bold',
    ]

    it('accepts the three embedded Plex faces', () => {
        expect(checkFonts(fonts, plex)).toEqual({
            ok: true,
            problems: [],
        })
    })

    it('flags a fallback font and a face left unembedded', () => {
        const fallback = `${fonts}ABCDEF+LMRoman10-Regular             Type 1C           Builtin          yes yes no      12  0\n`
        expect(checkFonts(fallback, plex).problems).toEqual([
            'Fallback font in PDF: LMRoman10-Regular',
        ])
        const unembedded = fonts.replace(/(IBMPlexSans-Bold\s.*?)yes yes yes/, '$1no  yes yes')
        expect(checkFonts(unembedded, plex).problems).toEqual([
            'Font not embedded: IBMPlexSans-Bold',
            'Font missing from PDF: IBMPlexSans-Bold',
        ])
    })
})

describe('XeLaTeX log', () => {
    it('takes the widest overfull box and useful warnings, once each', () => {
        const log = [
            'Overfull \\hbox (1.5pt too wide) in paragraph at lines 40--41',
            '[]\\TU/IBMPlexSans-Regular.ttf(0)/m/n/9.5 text',
            'Overfull \\hbox (12.25003pt too wide) in paragraph at lines 52--52',
            'Underfull \\hbox (badness 10000) in paragraph at lines 60--61',
            'LaTeX Warning: Label(s) may have changed.',
            'Package hyperref Warning: Token not allowed in a PDF string (Unicode):',
            "(hyperref)                removing `\\hl' on input line 3.",
            'Package microtype Warning: Unknown slot number of character',
            'Missing character: There is no ★ (U+2605) in font [fonts/IBMPlexSans-SemiBold.ttf]/OT:script=latn;language=dflt;-liga;+kern;mapping=tex-text;!',
            'Missing character: There is no ★ (U+2605) in font [fonts/IBMPlexSans-SemiBold.ttf]/OT:script=latn;language=dflt;-liga;+kern;mapping=tex-text;!',
        ].join('\n')
        expect(parseLog(log)).toEqual({
            overfullPt: 12.25,
            warnings: [
                'Overfull \\hbox (1.5pt too wide) in paragraph at lines 40--41',
                'Overfull \\hbox (12.25003pt too wide) in paragraph at lines 52--52',
                'Underfull \\hbox (badness 10000) in paragraph at lines 60--61',
                'LaTeX Warning: Label(s) may have changed.',
                "Package hyperref Warning: Token not allowed in a PDF string (Unicode): removing `\\hl' on input line 3.",
                'Missing character: ★ (U+2605) in IBMPlexSans-SemiBold.ttf',
            ],
        })
        expect(parseLog('clean run\n')).toEqual({
            overfullPt: 0,
            warnings: [],
        })
    })

    it("gives the first error with its context, without TeX's statistics", () => {
        const log = [
            '(./content.tex',
            '! Undefined control sequence.',
            'l.27 \\cvsection{Skills}\\undefinedmacro',
            '                                      {x} ',
            "Here is how much of TeX's memory you used:",
            ' 14381 strings out of 478053',
        ].join('\n')
        expect(logTail(log)).toEqual([
            '! Undefined control sequence.',
            'l.27 \\cvsection{Skills}\\undefinedmacro',
            '                                      {x} ',
        ])
        expect(logTail('a\nb\nc', 2)).toEqual([
            'b',
            'c',
        ])
    })

    it('reads the page count from pdfinfo', () => {
        expect(pdfPages('Producer: xdvipdfmx\nPages:           2\n')).toBe(2)
        expect(() => pdfPages('nothing')).toThrow()
    })
})
