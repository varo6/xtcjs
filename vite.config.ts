import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import devServer from '@hono/vite-dev-server'
import { VitePWA } from 'vite-plugin-pwa'
import { copyPdfJsWasmAssets } from './scripts/pdfjs-wasm'

const projectRoot = import.meta.dirname

export default defineConfig({
  optimizeDeps: {
    exclude: ['@jsquash/jxl'],
  },
  worker: {
    format: 'es',
  },
  plugins: [
    TanStackRouterVite({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    devServer({
      entry: 'server/dev.ts',
      exclude: [
        // Exclude everything except /api routes
        /^(?!\/api).*/,
      ],
      injectClientScript: false,
    }),
    {
      name: 'pdfjs-wasm-assets',
      async writeBundle(options) {
        await copyPdfJsWasmAssets(
          resolve(projectRoot, 'node_modules/pdfjs-dist/wasm'),
          resolve(projectRoot, options.dir ?? 'dist', 'pdfjs/wasm'),
        )
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'XTC.js - CBZ & PDF to XTC Converter',
        short_name: 'XTC.js',
        description: 'Convert CBZ comics and PDF documents to XTC format for your XTEink X4 e-reader.',
        theme_color: '#fafafa',
        background_color: '#fafafa',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
  },
  ssr: {
    external: ['bun:sqlite'],
  },
})
