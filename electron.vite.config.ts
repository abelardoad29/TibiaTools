import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version

const alias = {
  '@core': resolve('src/core'),
  '@shared': resolve('src/shared'),
  '@seed': resolve('seed'),
}

// En desarrollo, el preámbulo de React Refresh es un script inline: solo entonces se relaja la CSP.
const devCsp = (): Plugin => ({
  name: 'dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
})

export default defineConfig({
  main: { resolve: { alias } },
  preload: {
    resolve: { alias },
    // Los preload con sandbox deben ser CommonJS.
    build: { rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    resolve: { alias: { ...alias, '@renderer': resolve('src/renderer') } },
    plugins: [react(), tailwindcss(), devCsp()],
    define: { __APP_VERSION__: JSON.stringify(version) },
  },
})
