import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
    { ignores: ['out/**', 'dist/**', '.vscode-test/**'] },
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tsParser,
            ecmaVersion: 2022,
            sourceType: 'module',
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: { '@typescript-eslint': tsPlugin },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            '@typescript-eslint/naming-convention': [
                'warn',
                { selector: 'typeLike', format: ['PascalCase'] },
            ],
            // The command handler is invoked for its side effects; a dropped
            // rejection there would be an editor edit silently going missing.
            '@typescript-eslint/no-floating-promises': 'error',
            curly: 'warn',
            eqeqeq: 'warn',
            'no-throw-literal': 'warn',
            semi: ['warn', 'always'],
        },
    },
    {
        files: ['src/test/**/*.ts'],
        rules: {
            // `describe`/`it` from node:test return promises that the test
            // runner itself awaits; there is nothing for the caller to handle.
            '@typescript-eslint/no-floating-promises': 'off',
            // The `vscode` stub has to be installed before the module under
            // test is loaded, which a hoisted `import` cannot express.
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
];
