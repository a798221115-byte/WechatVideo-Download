import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    ignores: ['node_modules/**', 'dist/**', 'data/**', 'downloads/**', 'logs/**']
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        window: 'readonly',
        document: 'readonly',
        MutationObserver: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        Uint8Array: 'readonly',
        location: 'readonly',
        getComputedStyle: 'readonly',
        alert: 'readonly',
        clearTimeout: 'readonly'
      }
    },
    rules: {
      'no-console': 'off',
      'no-control-regex': 'off'
    }
  }
];
