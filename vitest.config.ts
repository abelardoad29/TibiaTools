import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@shared': resolve('src/shared'),
      '@seed': resolve('seed'),
      '@renderer': resolve('src/renderer'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
