import { describe, expect, it } from 'vitest'
import { cleanText, plainText, texEscape, texLinkText, texRich, texUrl } from './latex.js'

describe('texEscape', () => {
    it('escapes every TeX special character', () => {
        expect(texEscape('& % $ # _ { } ~ ^ \\')).toBe(
            '\\& \\% \\$ \\# \\_ \\{ \\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}',
        )
    })

    it('keeps Unicode, dashes and quotes as they are', () => {
        expect(texEscape('Zürich – São Paulo · Тбилиси “ok” C++')).toBe('Zürich – São Paulo · Тбилиси “ok” C++')
    })

    it('folds whitespace, drops invisible characters, keeps no-break spaces', () => {
        expect(texEscape('  a\n\tb\u200b c\u00add\u0007 ')).toBe('a b cd')
        expect(texEscape('1.7\u00a0s')).toBe('1.7~s')
    })

    it('never leaves a backslash that starts a command', () => {
        const tex = texEscape('\\input{/etc/passwd} \\def\\x{} \\write18{ls} \\immediate\\openout')
        expect(tex).not.toMatch(/\\(?!textbackslash\{\}|[{}])/)
    })

    it('leaves no unbalanced brace or comment that could escape a macro argument', () => {
        const tex = texEscape('}{\\end{document}% \\catcode`\\@=0')
        expect(tex).toBe('\\}\\{\\textbackslash{}end\\{document\\}\\% \\textbackslash{}catcode`\\textbackslash{}@=0')
    })
})

describe('texRich', () => {
    it('turns **spans** into \\hl and escapes inside and outside', () => {
        expect(texRich('Cut latency by **40% & more** in Q1_2025.')).toBe(
            'Cut latency by \\hl{40\\% \\& more} in Q1\\_2025.',
        )
    })

    it('keeps the spaces around a span', () => {
        expect(texRich('a **b** c **d**')).toBe('a \\hl{b} c \\hl{d}')
        expect(texRich('x ** y ** z')).toBe('x  \\hl{y}  z')
    })

    it('prints unpaired or empty markers literally', () => {
        expect(texRich('5 ** 2 = 25')).toBe('5 ** 2 = 25')
        expect(texRich('a **** b')).toBe('a **** b')
    })

    it('escapes a command inside a span', () => {
        expect(texRich('**\\input{x}**')).toBe('\\hl{\\textbackslash{}input\\{x\\}}')
    })
})

describe('plainText', () => {
    it('removes highlight markers and folds whitespace', () => {
        expect(plainText(' Built **3** apps\nfast ')).toBe('Built 3 apps fast')
    })
})

describe('links', () => {
    it('escapes URLs so hyperref writes them back unchanged', () => {
        expect(texUrl('https://example.com/a_b?x=1&y=50%#top')).toBe('https://example.com/a_b?x=1&y=50\\%\\#top')
    })

    it('percent-encodes characters TeX would read as syntax, and non-ASCII', () => {
        expect(texUrl('https://example.com/~me/{a}^b c/ü\\')).toBe(
            'https://example.com/\\%7Eme/\\%7Ba\\%7D\\%5Eb\\%20c/\\%C3\\%BC\\%5C',
        )
    })

    it('keeps two hyphens in link text', () => {
        expect(texLinkText('example.com/a--b_c')).toBe('example.com/a-{}-b\\_c')
    })

    it('cleanText trims and folds', () => {
        expect(cleanText('\n a  b \r\n')).toBe('a b')
    })
})
