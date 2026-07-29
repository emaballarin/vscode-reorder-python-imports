import esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const context = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    bundle: true,
    format: 'cjs',
    platform: 'node',
    // Matches the Node runtime shipped in the Electron of the minimum
    // supported VS Code (see `engines.vscode`).
    target: 'node20',
    // Provided by the extension host at runtime; bundling it would break it.
    external: ['vscode'],
    minify: production,
    sourcemap: !production,
    logLevel: 'info',
});

if (watch) {
    await context.watch();
} else {
    await context.rebuild();
    await context.dispose();
}
