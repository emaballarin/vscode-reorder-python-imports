import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changesSubstring, normalizeEol, splitArgs, toLf } from '../textDiff';

/** Applies a `changesSubstring` result the way the editor edit does. */
function apply(
    original: string,
    other: string,
    change: ReturnType<typeof changesSubstring>,
): string {
    if (change === 'no-change') {
        return original;
    }
    if (change === 'full-change') {
        return other;
    }

    const [[start, length], [otherStart, otherLength]] = change;
    assert.ok(length >= 0, `negative original length: ${length}`);
    assert.ok(otherLength >= 0, `negative replacement length: ${otherLength}`);

    return (
        original.slice(0, start) +
        other.slice(otherStart, otherStart + otherLength) +
        original.slice(start + length)
    );
}

describe('changesSubstring', () => {
    it('reports identical input as unchanged', () => {
        assert.equal(
            changesSubstring('import os\n', 'import os\n'),
            'no-change',
        );
    });

    it('reports a buffer sharing neither end as a full change', () => {
        assert.equal(changesSubstring('abc', 'xyz'), 'full-change');
    });

    it('still narrows when only the trailing newline is shared', () => {
        assert.deepEqual(changesSubstring('import os\n', 'x = 1\n'), [
            [0, 9],
            [0, 5],
        ]);
    });

    it('returns the documented example', () => {
        assert.deepEqual(changesSubstring('abcdefgh', 'abcxyzh'), [
            [3, 4],
            [3, 3],
        ]);
    });

    it('narrows a reordering to the lines that moved', () => {
        assert.deepEqual(
            changesSubstring('import b\nimport a\n', 'import a\nimport b\n'),
            [
                [7, 10],
                [7, 10],
            ],
        );
    });

    // Every case below straddles repeated text, where an unclamped common
    // prefix and suffix overlap and produce negative lengths.
    const overlapping: [string, string, string][] = [
        ['de-duplicated import', 'import a\nimport a\n', 'import a\n'],
        ['added duplicate line', 'import a\n', 'import a\nimport a\n'],
        [
            'collapsed blank lines',
            'import a\n\n\n\nx = 1\n',
            'import a\n\n\nx = 1\n',
        ],
        ['repeated prefix trim', 'aaaa', 'aa'],
        ['appended newline', 'import a', 'import a\n'],
    ];

    for (const [name, original, other] of overlapping) {
        it(`round-trips a ${name}`, () => {
            assert.equal(
                apply(original, other, changesSubstring(original, other)),
                other,
            );
        });
    }

    it('round-trips exhaustively over short strings', () => {
        const alphabet = ['a', 'b', '\n'];
        const words = [''];
        for (let length = 1; length <= 4; length++) {
            for (const word of words.filter((w) => w.length === length - 1)) {
                for (const char of alphabet) {
                    words.push(word + char);
                }
            }
        }

        for (const original of words) {
            for (const other of words) {
                assert.equal(
                    apply(original, other, changesSubstring(original, other)),
                    other,
                    `${JSON.stringify(original)} -> ${JSON.stringify(other)}`,
                );
            }
        }
    });
});

describe('splitArgs', () => {
    it('keeps an unquoted argument intact', () => {
        assert.deepEqual(splitArgs('--application-directories=.:src'), [
            '--application-directories=.:src',
        ]);
    });

    it('splits the shell-quoted form documented in the README', () => {
        assert.deepEqual(
            splitArgs("--add-import 'from __future__ import annotations'"),
            ['--add-import', 'from __future__ import annotations'],
        );
    });

    it('handles double quotes and collapses runs of whitespace', () => {
        assert.deepEqual(splitArgs('  --py3-plus   "a  b"  '), [
            '--py3-plus',
            'a  b',
        ]);
    });

    it('preserves an explicitly empty argument', () => {
        assert.deepEqual(splitArgs("--add-import ''"), ['--add-import', '']);
    });

    it('never merges shell metacharacters into a command', () => {
        // Passed as argv, so these are inert operands rather than a second command.
        assert.deepEqual(splitArgs('; rm -rf ~ && echo pwned'), [
            ';',
            'rm',
            '-rf',
            '~',
            '&&',
            'echo',
            'pwned',
        ]);
    });

    it('drops an empty or whitespace-only entry', () => {
        assert.deepEqual(splitArgs('   '), []);
    });

    it('closes an unterminated quote at the end of the entry', () => {
        // Malformed, but it must still yield inert arguments rather than
        // dropping the tail or throwing.
        assert.deepEqual(splitArgs("--add-import 'import os"), [
            '--add-import',
            'import os',
        ]);
    });

    it('keeps a Windows path with backslashes intact', () => {
        assert.deepEqual(splitArgs('--application-directories=C:\\src'), [
            '--application-directories=C:\\src',
        ]);
    });
});

describe('line endings', () => {
    it('collapses the doubled carriage returns a text-mode stdout produces', () => {
        assert.equal(toLf('a\r\r\nb\r\r\n'), 'a\nb\n');
    });

    it('normalises mixed endings', () => {
        assert.equal(toLf('a\r\nb\rc\nd'), 'a\nb\nc\nd');
    });

    it('round-trips through CRLF without doubling', () => {
        assert.equal(normalizeEol('a\r\r\nb\n', '\r\n'), 'a\r\nb\r\n');
        assert.equal(normalizeEol('a\r\nb\r\n', '\n'), 'a\nb\n');
    });
});
