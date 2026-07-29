import * as vscode from 'vscode';
import { ReorderImportsProvider } from './reorderImportsProvider';

/** Registers the reorder command and the organize-imports code action. */
export function activate(context: vscode.ExtensionContext): void {
    const log = vscode.window.createOutputChannel('reorder-python-imports', {
        log: true,
    });
    const provider = new ReorderImportsProvider(log);

    context.subscriptions.push(
        log,
        // The command id must match the one contributed in package.json. The
        // promise is returned rather than discarded so that anything awaiting
        // the command waits for the edit; `reorderImports` handles its own
        // failures, so it never rejects.
        vscode.commands.registerTextEditorCommand(
            'reorder-python-imports.reorderImports',
            (editor) => provider.reorderImports(editor),
        ),
        vscode.languages.registerCodeActionsProvider(
            { language: 'python' },
            provider,
            {
                providedCodeActionKinds: ReorderImportsProvider.PROVIDED_KINDS,
            },
        ),
    );

    log.info('"reorder-python-imports" is now active.');
}

/** Nothing to tear down: every disposable is owned by the extension context. */
export function deactivate(): void {}
