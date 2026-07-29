import { execFile } from 'node:child_process';
import {
    CodeAction,
    CodeActionKind,
    CodeActionProvider,
    EndOfLine,
    LogOutputChannel,
    Position,
    ProviderResult,
    Range,
    TextEditor,
    window,
    workspace,
} from 'vscode';
import { changesSubstring, normalizeEol, splitArgs, toLf } from './textDiff';
import { resolveInvocation } from './toolResolver';

/**
 * Upper bound on the rewritten source held in memory.
 *
 * `execFile` defaults to 1 MiB and fails the call once that is exceeded, which
 * silently broke large modules.
 */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * How long the tool may run before it is killed.
 *
 * Sorting imports is near-instant; anything approaching this is wedged, and a
 * wedged child would otherwise keep the document locked out of reordering for
 * the rest of the session.
 */
const TIMEOUT_MS = 30_000;

type SpawnFailure = NodeJS.ErrnoException & {
    stderr?: string;
    killed?: boolean;
};

/**
 * Runs `file` with `args`, feeding `input` on stdin.
 *
 * The executable and its arguments are passed as an argv array, so no shell is
 * involved and nothing in the user's settings can be interpreted as a command.
 */
function run(
    file: string,
    args: string[],
    input: string,
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = execFile(
            file,
            args,
            {
                maxBuffer: MAX_OUTPUT_BYTES,
                timeout: TIMEOUT_MS,
                windowsHide: true,
            },
            (error, stdout, stderr) => {
                if (error) {
                    reject(Object.assign(error, { stderr }));
                    return;
                }
                resolve({ stdout, stderr });
            },
        );

        // A spawn that never got off the ground tears down stdin; the resulting
        // EPIPE would otherwise surface as an unhandled error on the extension
        // host rather than as the ENOENT reported to the callback above.
        child.stdin?.on('error', () => undefined);
        child.stdin?.end(input);
    });
}

/** Turns a spawn or exit failure into a message that says what to do about it. */
function describeFailure(error: SpawnFailure): string {
    if (error.code === 'ENOENT') {
        return "Reorder Imports: 'reorder-python-imports' was not found. Install it into the selected interpreter (pip install reorder-python-imports), or set 'reorderPythonImports.path'.";
    }

    if (error.code === 'EACCES') {
        return "Reorder Imports: 'reorder-python-imports' is not executable.";
    }

    if (error.killed) {
        return `Reorder Imports: the tool did not finish within ${TIMEOUT_MS / 1000} seconds and was stopped.`;
    }

    return `Reorder Imports failed: ${error.stderr?.trim() || error.message}`;
}

export class ReorderImportsProvider implements CodeActionProvider {
    public static readonly PROVIDED_KINDS = [
        // This will also get triggered from `CodeActionKind.SourceOrganizeImports`, as
        // it "extends" from that kind.
        CodeActionKind.SourceOrganizeImports.append('reorder-python-imports'),
    ];

    /**
     * Documents with a run in flight.
     *
     * Organize-on-save and a manual invocation can overlap, and the second run
     * would compute its edit against text the first is about to replace.
     */
    private readonly inFlight = new Set<string>();

    constructor(private readonly log: LogOutputChannel) {}

    provideCodeActions(): ProviderResult<CodeAction[]> {
        const action = new CodeAction(
            'Reorder Imports',
            ReorderImportsProvider.PROVIDED_KINDS[0],
        );
        action.command = {
            command: 'reorder-python-imports.reorderImports',
            title: 'Reorder Imports',
        };

        return [action];
    }

    public async reorderImports(editor: TextEditor): Promise<void> {
        const doc = editor.document;

        // The command is reachable from the palette and from keybindings, not
        // only from the Python-scoped code action.
        if (doc.languageId !== 'python') {
            this.log.info(
                `Ignoring a non-Python document (${doc.languageId}).`,
            );
            void window.showInformationMessage(
                'Reorder Imports only applies to Python files.',
            );
            return;
        }

        const key = doc.uri.toString();
        if (this.inFlight.has(key)) {
            this.log.debug(`Already reordering ${key}; skipping this request.`);
            return;
        }
        this.inFlight.add(key);

        this.log.info(`Reordering ${key}`);

        try {
            const invocation = await resolveInvocation(doc, this.log);
            this.log.debug(
                `Executable: ${invocation.file} (${invocation.origin})`,
            );

            const configuredArgs =
                workspace
                    .getConfiguration('reorder-python-imports', doc.uri)
                    .get<string[]>('args') ?? [];

            // `--exit-zero-even-if-changed` keeps a rewritten file from being
            // reported as a failure; the diff below decides what actually
            // changed. `-` makes the tool read from stdin.
            const args = [
                ...invocation.leadingArgs,
                ...new Set([
                    '--exit-zero-even-if-changed',
                    ...configuredArgs.flatMap(splitArgs),
                ]),
                '-',
            ];
            this.log.debug(`Arguments: ${JSON.stringify(args)}`);

            const original = doc.getText();

            // The tool is fed LF only. On Windows its stdout is a text stream,
            // so every `\n` it writes comes back as `\r\n`; sending CRLF in
            // would come back as `\r\r\n`. Normalising both ends keeps that
            // translation out of the buffer.
            const { stdout, stderr } = await run(
                invocation.file,
                args,
                toLf(original),
            );

            if (stderr.trim().length > 0) {
                this.log.debug(`stderr: ${stderr.trim()}`);
            }

            const updated = normalizeEol(
                stdout,
                doc.eol === EndOfLine.CRLF ? '\r\n' : '\n',
            );

            const change = changesSubstring(original, updated);

            if (change === 'no-change') {
                this.log.info('No change.');
                return;
            }

            // `original` was captured before an await, so the offsets below only
            // describe this document if it has not been touched since.
            if (doc.isClosed || doc.getText() !== original) {
                this.log.warn(
                    'Document changed while reordering; discarding the edit.',
                );
                return;
            }

            const [range, replacement] =
                change === 'full-change'
                    ? ([
                          new Range(
                              new Position(0, 0),
                              doc.positionAt(original.length),
                          ),
                          updated,
                      ] as const)
                    : ([
                          new Range(
                              doc.positionAt(change[0][0]),
                              doc.positionAt(change[0][0] + change[0][1]),
                          ),
                          updated.slice(
                              change[1][0],
                              change[1][0] + change[1][1],
                          ),
                      ] as const);

            this.log.debug(
                `Replacing ${JSON.stringify(range)} with ${JSON.stringify(replacement)}`,
            );

            // Applied through this callback rather than the command's own edit
            // builder, which is invalidated by the awaits above.
            const applied = await editor.edit((edit) =>
                edit.replace(range, replacement),
            );

            if (!applied) {
                this.log.error('VS Code rejected the edit.');
                void window.showErrorMessage(
                    'Reorder Imports: the edit could not be applied.',
                );
            }
        } catch (error) {
            const failure = error as SpawnFailure;
            this.log.error(failure.stack ?? String(failure));

            void window
                .showErrorMessage(describeFailure(failure), 'Show Log')
                .then((choice) => {
                    if (choice === 'Show Log') {
                        this.log.show();
                    }
                });
        } finally {
            this.inFlight.delete(key);
        }
    }
}
