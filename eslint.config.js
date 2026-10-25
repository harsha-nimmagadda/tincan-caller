import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import i18next from 'eslint-plugin-i18next';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: ['src/ui/**/*.tsx', 'src/App.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
    ...i18next.configs['flat/recommended'],
  },
  {
    // Pure core must not touch the DOM or React (Rules §4); platform/ and media/ are the exceptions.
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/platform/**', 'src/core/media/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['react', 'react-dom', 'react/*'] }],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'Pure core: no DOM access.' },
        { name: 'document', message: 'Pure core: no DOM access.' },
      ],
    },
  },
  {
    files: ['*.config.{js,ts}', 'scripts/**', 'test/**'],
    languageOptions: { globals: { ...globals.node } },
  },
);
