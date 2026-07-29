import { access, constants } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PythonExtension } from '@vscode/python-extension';
import {
    LogOutputChannel,
    TextDocument,
    Uri,
    extensions,
    workspace,
} from 'vscode';

/** Base name of the console script installed by `reorder-python-imports`. */
const SCRIPT_NAME =
    process.platform === 'win32'
        ? 'reorder-python-imports.exe'
        : 'reorder-python-imports';

/** Importable name of the same tool, used when no console script is found. */
const MODULE_NAME = 'reorder_python_imports';

/** How to start the tool: an executable plus the arguments that must precede the user's. */
export interface Invocation {
    file: string;
    leadingArgs: string[];
    /** How this was resolved, for the log. */
    origin: string;
}

/** The parts of a Python environment needed to locate its console scripts. */
interface PythonEnvironment {
    executable: string;
    sysPrefix?: string;
}

/** Shape of the pre-`environments` Python extension API, still worth honouring. */
interface LegacyPythonApi {
    settings?: {
        getExecutionDetails?: (resource?: Uri) => { execCommand?: unknown };
    };
}

/** Reports whether `file` exists and can be spawned. */
async function isExecutableFile(file: string): Promise<boolean> {
    try {
        // X_OK is not meaningful on Windows, where the mode bits do not model
        // executability; existence is the most that can be checked there.
        await access(
            file,
            process.platform === 'win32' ? constants.F_OK : constants.X_OK,
        );
        return true;
    } catch {
        return false;
    }
}

/** Expands `~` and anchors a relative path to the document's workspace folder. */
function resolveUserPath(configured: string, doc: TextDocument): string {
    if (configured.startsWith('~')) {
        return path.resolve(path.join(os.homedir(), configured.slice(1)));
    }

    if (path.isAbsolute(configured)) {
        return configured;
    }

    // Anchored to the workspace rather than the extension host's working
    // directory, which the user has no way to reason about.
    const folder = workspace.getWorkspaceFolder(doc.uri);
    return folder
        ? path.resolve(folder.uri.fsPath, configured)
        : path.resolve(configured);
}

/** Returns the interpreter that the Python extension has selected for `resource`. */
async function getPythonEnvironment(resource: Uri): Promise<PythonEnvironment> {
    const ext = extensions.getExtension<PythonExtension>('ms-python.python');

    if (!ext) {
        throw new Error(
            "Can't find the 'ms-python.python' extension, which is needed to locate the active interpreter.",
        );
    }

    if (!ext.isActive) {
        await ext.activate();
    }

    const api = ext.exports;

    // Preferred path: the stable environments API, resolved per resource so
    // that each folder of a multi-root workspace uses its own interpreter.
    const environments = api?.environments;
    if (environments) {
        const active = environments.getActiveEnvironmentPath(resource);
        const resolved = active
            ? await environments.resolveEnvironment(active)
            : undefined;
        const executable = resolved?.executable.uri?.fsPath;

        if (executable) {
            return { executable, sysPrefix: resolved?.executable.sysPrefix };
        }
    }

    // Older Python extensions only expose the settings API.
    const execCommand = (
        api as unknown as LegacyPythonApi
    )?.settings?.getExecutionDetails?.(resource)?.execCommand;
    const legacy = Array.isArray(execCommand) ? execCommand[0] : undefined;

    if (typeof legacy === 'string' && legacy.length > 0) {
        return { executable: legacy };
    }

    throw new Error(
        'The Python extension did not report an active interpreter. Choose one with the "Python: Select Interpreter" command.',
    );
}

/**
 * Directories that may hold the environment's console scripts, best guess first.
 *
 * In a venv the scripts sit next to the interpreter, but a conda environment on
 * Windows keeps the interpreter at the environment root and the scripts under
 * `Scripts`, which only `sys.prefix` can bridge. Layouts neither entry covers —
 * a system interpreter whose scripts went to `~/.local/bin`, say — are left to
 * the module fallback.
 */
function scriptDirectories(env: PythonEnvironment): string[] {
    const binDir = process.platform === 'win32' ? 'Scripts' : 'bin';
    const dirs = [path.dirname(env.executable)];

    if (env.sysPrefix) {
        dirs.push(path.join(env.sysPrefix, binDir));
    }

    return [...new Set(dirs)];
}

/**
 * Works out how to run `reorder-python-imports` for `doc`.
 *
 * An explicitly configured path wins; otherwise the environment's console
 * script is used, and failing that the tool is run as a module — which works
 * wherever the package is importable, even when no script was ever generated.
 */
export async function resolveInvocation(
    doc: TextDocument,
    log: LogOutputChannel,
): Promise<Invocation> {
    const configured = workspace
        .getConfiguration('reorderPythonImports', doc.uri)
        .get<string>('path');

    if (configured) {
        return {
            file: resolveUserPath(configured, doc),
            leadingArgs: [],
            origin: 'reorderPythonImports.path',
        };
    }

    const env = await getPythonEnvironment(doc.uri);

    for (const dir of scriptDirectories(env)) {
        const candidate = path.join(dir, SCRIPT_NAME);
        if (await isExecutableFile(candidate)) {
            return {
                file: candidate,
                leadingArgs: [],
                origin: 'console script',
            };
        }
    }

    log.debug(
        `No ${SCRIPT_NAME} beside ${env.executable}; running the module instead.`,
    );

    return {
        file: env.executable,
        leadingArgs: ['-m', MODULE_NAME],
        origin: `${MODULE_NAME} module`,
    };
}
