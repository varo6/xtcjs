import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { api } from './api'

const app = new Hono()

// Mount API routes under /api
app.route('/api', api)

// Serve static files from dist directory
app.use('/*', serveStatic({ root: './dist' }))

// Fallback to index.html for SPA routing
app.get('*', serveStatic({ path: './dist/index.html' }))

export default {
  port: 3000,
  fetch: app.fetch,
}
