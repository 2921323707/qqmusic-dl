import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['.git/**', 'data/**', 'dist/**', 'downloads/**', 'node_modules/**', 'vendor/**'],
  },
  js.configs.recommended,
  {
    files: ['eslint.config.js', 'src/**/*.js', 'electron/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['public/**/*.js', 'electron/lyrics.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },
  {
    files: ['electron/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
