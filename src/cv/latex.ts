/**
 * Plain text and URLs to TeX source for the "Minimal violet" template.
 * Every character that would act as TeX syntax is escaped; Unicode letters
 * stay as they are (XeLaTeX reads UTF-8). TeX ligatures of the template
 * (`--` en dash, `'` apostrophe) are kept on purpose. Callers never send
 * LaTeX: every text value of a CvDocument goes through these functions.
 */

const SPECIALS: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '{': '\\{',
    '}': '\\}',
    '%': '\\%',
    $: '\\$',
    '&': '\\&',
    '#': '\\#',
    _: '\\_',
    '^': '\\textasciicircum{}',
    '~': '\\textasciitilde{}',
}

/** Control characters, zero-width marks and the soft hyphen: never printed. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f­​-‍⁠﻿]/g
/** Any whitespace run except the no-break spaces, which become `~`. */
const SPACE_RUN = /[^\S  ]+/g
const NO_BREAK_SPACE = /[  ]/g
const HIGHLIGHT = /\*\*(.+?)\*\*/g

/** One line of text: invisible characters gone, whitespace folded, trimmed. */
export function cleanText(value: string): string {
    return value.replace(INVISIBLE, '').replace(SPACE_RUN, ' ').trim()
}

/** Cleaned text as TeX: specials escaped, no-break spaces as `~`. */
const escapeSpecials = (text: string) =>
    text.replace(/[\\{}%$&#_^~]/g, char => SPECIALS[char] ?? char).replace(NO_BREAK_SPACE, '~')

/** Plain text as TeX. */
export function texEscape(value: string): string {
    return escapeSpecials(cleanText(value))
}

/** Text with `**…**` spans: each span becomes `\hl{…}`, the rest is escaped. */
export function texRich(value: string): string {
    const text = cleanText(value)
    let result = ''
    let last = 0
    for (const match of text.matchAll(HIGHLIGHT)) {
        const span = match[1] ?? ''
        result += escapeSpecials(text.slice(last, match.index))
        // A space at a span edge stays outside, so `** a **` reads as ` a `.
        if (span.trim()) {
            if (span.startsWith(' ')) result += ' '
            result += `\\hl{${escapeSpecials(span.trim())}}`
            if (span.endsWith(' ')) result += ' '
        }
        last = match.index + match[0].length
    }
    return result + escapeSpecials(text.slice(last))
}

/** The text a reader sees: `**…**` markers removed, whitespace folded. */
export function plainText(value: string): string {
    return cleanText(cleanText(value).replace(HIGHLIGHT, '$1'))
}

/** Link text: escaped, and `--` kept as two hyphens instead of an en dash. */
export function texLinkText(value: string): string {
    return texEscape(value).replace(/-(?=-)/g, '-{}')
}

/**
 * A URL for `\href` inside a macro argument: characters TeX would read as
 * syntax there are percent-encoded (equivalent in a URL), non-ASCII as UTF-8,
 * and the remaining `%` and `#` are escaped, which hyperref turns back.
 */
export function texUrl(value: string): string {
    let encoded = ''
    for (const char of cleanText(value)) {
        const code = char.codePointAt(0) ?? 0
        if (code > 0x20 && code < 0x7f && !/[\\{}^~`"<>| ]/.test(char)) encoded += char
        else
            for (const byte of Buffer.from(char, 'utf8'))
                encoded += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    }
    return encoded.replace(/[%#]/g, char => `\\${char}`)
}
