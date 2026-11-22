import { defineConfig, mergeConfig } from 'vite'
import appConfig from '../vite.config'

// Production build of the real app (same plugins, same asset pipeline) plus a
// harness page that exposes the conversion modules to the tests.
export default mergeConfig(appConfig, defineConfig({
  build: {
    outDir: 'dist-e2e',
    rollupOptions: {
      input: {
        main: 'index.html',
        harness: 'e2e/harness/index.html',
      },
    },
  },
}))
