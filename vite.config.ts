import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import devServer from '@hono/vite-dev-server'

export default defineConfig({
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
  ],
  build: {
    outDir: 'dist',
  },
})
