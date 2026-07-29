/**
 * Pure text helpers shared by the extension.
 *
 * Nothing here imports `vscode`, so the module can be unit tested under a plain
 * node process.
 */

/**
 * Compares two strings and determines what the range of differences is.
 *
 * Returns [[originalStartIndex, originalLength], [otherStartIndex, otherLength]]
 *
 * Example: "abcdefgh" and "abcxyzh" would return `[[3, 4], [3, 3]]`
 *
 * The common prefix and the common suffix are never allowed to overlap: without
 * that clamp a change adjacent to repeated text (a de-duplicated import, a
 * collapsed run of blank lines) yields negative lengths, and the caller then
 * either drops the edit or wipes unrelated text.
 */
export function changesSubstring(
    original: string,
    other: string,
): 'no-change' | 'full-change' | [[number, number], [number, number]] {
    if (original === other) {
        return 'no-change';
    }

    const minLength = Math.min(original.length, other.length);

    let numFromStart; // Offset of the first change from the start of the strings
    for (numFromStart = 0; numFromStart < minLength; ++numFromStart) {
        if (original[numFromStart] !== other[numFromStart]) {
            break;
        }
    }

    // Whatever the prefix already claimed is off limits to the suffix.
    const maxFromEnd = minLength - numFromStart;

    let numFromEnd; // Offset of the last change from the end of the strings
    for (numFromEnd = 0; numFromEnd < maxFromEnd; ++numFromEnd) {
        if (
            original[original.length - numFromEnd - 1] !==
            other[other.length - numFromEnd - 1]
        ) {
            break;
        }
    }

    if (numFromStart === 0 && numFromEnd === 0) {
        return 'full-change';
    }

    return [
        [numFromStart, original.length - numFromEnd - numFromStart],
        [numFromStart, other.length - numFromEnd - numFromStart],
    ];
}

/**
 * Splits one configured argument into argv entries, honouring single and double
 * quotes.
 *
 * Arguments used to be interpolated into a shell command line, so settings in
 * the wild hold shell-quoted values such as `--add-import 'import os'` in a
 * single array entry. They are now handed to the process directly, which means
 * that quoting has to be resolved here — and only quoting: no expansion, no
 * substitution, and no metacharacter ever changes what gets executed.
 */
export function splitArgs(arg: string): string[] {
    const args: string[] = [];
    let current = '';
    let quote: "'" | '"' | null = null;
    let pending = false;

    for (const char of arg) {
        if (quote !== null) {
            if (char === quote) {
                quote = null;
            } else {
                current += char;
            }
        } else if (char === "'" || char === '"') {
            quote = char;
            pending = true;
        } else if (/\s/.test(char)) {
            if (pending) {
                args.push(current);
                current = '';
                pending = false;
            }
        } else {
            current += char;
            pending = true;
        }
    }

    if (pending) {
        args.push(current);
    }

    return args;
}

/** Rewrites every line ending — `\r\n`, `\r\r\n` or a lone `\r` — to a single LF. */
export function toLf(text: string): string {
    return text.replace(/\r*\n/g, '\n').replace(/\r/g, '\n');
}

/** Rewrites every line ending to `eol`. */
export function normalizeEol(text: string, eol: '\n' | '\r\n'): string {
    const lf = toLf(text);
    return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
}
