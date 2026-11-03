import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'dist-web/**', 'release/**', 'node_modules/**', 'seed/**', 'spikes/**', '.venv/**', 'coverage/**', 'src/renderer/public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    // El dinero se modela con enteros: parseFloat/toFixed en el dominio suelen indicar un float colado.
    files: ['src/core/domain/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'parseFloat', message: 'GP son enteros; usa parseGp/Number.parseInt.' }],
      'no-restricted-properties': ['error', { object: 'Number', property: 'parseFloat', message: 'GP son enteros.' }],
    },
  },
)
