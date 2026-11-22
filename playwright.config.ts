import { defineConfig, devices } from '@playwright/test'

const PORT = 4317
const viteConfig = 'e2e/vite.config.ts'

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 120_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Production build, so build-only bugs (missing assets, bundling) are caught.
  webServer: {
    command: `bun x vite build --config ${viteConfig} && bun x vite preview --config ${viteConfig} --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
})
