// Build de la PWA companion (Fase 14): el mismo renderer, con la plataforma web.
// Incluye herramientas, catálogo y TibiaData; el Collector y el análisis de Market son solo de escritorio.
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Rutas relativas a este archivo, no al cwd.
const resolve = (p: string) => resolvePath(import.meta.dirname, p)
const version = (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }).version

export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  publicDir: resolve('src/renderer/public'),
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@shared': resolve('src/shared'),
      '@seed': resolve('seed'),
      '@renderer': resolve('src/renderer'),
    },
  },
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: resolve('dist-web'), emptyOutDir: true },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.png', 'Rashid.gif'],
      manifest: {
        name: 'Tibia Tools',
        short_name: 'Tibia Tools',
        description: 'Herramientas de Tibia: Rashid, boosted, share exp, split loot, imbuements y catálogo de items.',
        lang: 'es',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        icons: [{ src: 'icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
      },
      workbox: {
        // El catálogo de items (≈2.5 MB) se precachea para funcionar sin conexión.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,png,gif}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/www\.tibiawiki\.com\.br\/(wiki\/Special:FilePath|images)\//,
            handler: 'CacheFirst',
            options: { cacheName: 'item-icons', expiration: { maxEntries: 6_000, maxAgeSeconds: 60 * 60 * 24 * 90 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
})
