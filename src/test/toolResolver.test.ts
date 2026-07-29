import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import Module from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

/** Mutable state backing the `vscode` stub, reset before each test. */
interface StubState {
    configuredPath?: string;
    workspaceFolder?: string;
    executable?: string;
    sysPrefix?: string;
    legacyExecCommand?: string[];
    withEnvironmentsApi: boolean;
    withPythonExtension: boolean;
}

const state: StubState = {
    withEnvironmentsApi: true,
    withPythonExtension: true,
};

function pythonExtensionStub() {
    const exports: Record<string, unknown> = {};

    if (state.withEnvironmentsApi) {
        exports.environments = {
            getActiveEnvironmentPath: () => ({
                id: 'test',
                path: state.executable,
            }),
            resolveEnvironment: () =>
                Promise.resolve(
                    state.executable
                        ? {
                              executable: {
                                  uri: { fsPath: state.executable },
                                  sysPrefix: state.sysPrefix,
                              },
                          }
                        : undefined,
                ),
        };
    }

    if (state.legacyExecCommand) {
        exports.settings = {
            getExecutionDetails: () => ({
                execCommand: state.legacyExecCommand,
            }),
        };
    }

    return { isActive: true, activate: () => Promise.resolve(), exports };
}

const vscodeStub = {
    workspace: {
        getConfiguration: (section: string) => ({
            get: (key: string) =>
                section === 'reorderPythonImports' && key === 'path'
                    ? state.configuredPath
                    : undefined,
        }),
        getWorkspaceFolder: () =>
            state.workspaceFolder
                ? { uri: { fsPath: state.workspaceFolder } }
                : undefined,
    },
    extensions: {
        getExtension: () =>
            state.withPythonExtension ? pythonExtensionStub() : undefined,
    },
};

// Installed before `../toolResolver` is loaded, so its `vscode` import resolves
// to the stub above rather than failing outside the extension host.
const loader = Module as unknown as {
    _load: (request: string, ...rest: unknown[]) => unknown;
};
const realLoad = loader._load;
loader._load = function (request: string, ...rest: unknown[]) {
    return request === 'vscode'
        ? vscodeStub
        : realLoad.call(this, request, ...rest);
};

const { resolveInvocation } =
    require('../toolResolver') as typeof import('../toolResolver');

const SCRIPT_NAME =
    process.platform === 'win32'
        ? 'reorder-python-imports.exe'
        : 'reorder-python-imports';
const BIN_DIR = process.platform === 'win32' ? 'Scripts' : 'bin';

const log = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
} as never;

const doc = {
    uri: { toString: () => 'file:///project/x.py', fsPath: '/project/x.py' },
} as never;

/** Creates `dir` and puts a runnable stand-in for the console script in it. */
async function makeScript(dir: string): Promise<string> {
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, SCRIPT_NAME);
    await writeFile(file, '#!/bin/sh\ncat\n');
    await chmod(file, 0o755);
    return file;
}

async function makeInterpreter(dir: string): Promise<string> {
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'python');
    await writeFile(file, '#!/bin/sh\ncat\n');
    await chmod(file, 0o755);
    return file;
}

describe('resolveInvocation', () => {
    beforeEach(() => {
        state.configuredPath = undefined;
        state.workspaceFolder = undefined;
        state.executable = undefined;
        state.sysPrefix = undefined;
        state.legacyExecCommand = undefined;
        state.withEnvironmentsApi = true;
        state.withPythonExtension = true;
    });

    it('uses the console script sitting beside the interpreter', async () => {
        const env = await mkdtemp(path.join(tmpdir(), 'rpi-venv-'));
        state.executable = await makeInterpreter(path.join(env, BIN_DIR));
        state.sysPrefix = env;
        const script = await makeScript(path.join(env, BIN_DIR));

        const invocation = await resolveInvocation(doc, log);

        assert.equal(invocation.file, script);
        assert.deepEqual(invocation.leadingArgs, []);
    });

    // The conda layout: the interpreter lives at the environment root while the
    // console scripts live under a separate directory, so looking only next to
    // the interpreter finds nothing.
    it('finds the script via sys.prefix when it is not beside the interpreter', async () => {
        const env = await mkdtemp(path.join(tmpdir(), 'rpi-conda-'));
        state.executable = await makeInterpreter(env);
        state.sysPrefix = env;
        const script = await makeScript(path.join(env, BIN_DIR));

        const invocation = await resolveInvocation(doc, log);

        assert.equal(invocation.file, script);
        assert.notEqual(path.dirname(script), path.dirname(state.executable));
        assert.deepEqual(invocation.leadingArgs, []);
    });

    it('runs the tool as a module when no console script exists', async () => {
        const env = await mkdtemp(path.join(tmpdir(), 'rpi-noscript-'));
        state.executable = await makeInterpreter(path.join(env, BIN_DIR));
        state.sysPrefix = env;

        const invocation = await resolveInvocation(doc, log);

        assert.equal(invocation.file, state.executable);
        assert.deepEqual(invocation.leadingArgs, [
            '-m',
            'reorder_python_imports',
        ]);
    });

    it('prefers an explicitly configured absolute path', async () => {
        const env = await mkdtemp(path.join(tmpdir(), 'rpi-configured-'));
        const script = await makeScript(env);
        state.configuredPath = script;
        state.executable = '/never/used/python';

        const invocation = await resolveInvocation(doc, log);

        assert.equal(invocation.file, script);
        assert.equal(invocation.origin, 'reorderPythonImports.path');
    });

    it('anchors a relative configured path to the workspace folder', async () => {
        state.workspaceFolder = path.join(tmpdir(), 'some-project');
        state.configuredPath = path.join('.venv', BIN_DIR, SCRIPT_NAME);

        const invocation = await resolveInvocation(doc, log);

        assert.equal(
            invocation.file,
            path.join(state.workspaceFolder, state.configuredPath),
        );
    });

    it('falls back to the legacy settings API', async () => {
        const env = await mkdtemp(path.join(tmpdir(), 'rpi-legacy-'));
        const interpreter = await makeInterpreter(path.join(env, BIN_DIR));
        const script = await makeScript(path.join(env, BIN_DIR));

        state.withEnvironmentsApi = false;
        state.legacyExecCommand = [interpreter];

        const invocation = await resolveInvocation(doc, log);

        assert.equal(invocation.file, script);
    });

    it('reports a missing Python extension', async () => {
        state.withPythonExtension = false;

        await assert.rejects(
            () => resolveInvocation(doc, log),
            /ms-python\.python/,
        );
    });

    it('reports an environment with no interpreter', async () => {
        await assert.rejects(
            () => resolveInvocation(doc, log),
            /did not report an active interpreter/,
        );
    });
});
