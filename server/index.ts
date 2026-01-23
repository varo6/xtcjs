import { Hono } from 'hono'
import { api } from './api'

const app = new Hono()

// Mount API routes under /api
app.route('/api', api)

// Serve static files and SPA fallback using Bun.file()
app.get('*', async (c) => {
  const path = new URL(c.req.url).pathname
  const distDir = import.meta.dir + '/../dist'

  // Try to serve the requested file
  let file = Bun.file(distDir + path)
  if (await file.exists()) {
    return new Response(file)
  }

  // Fallback to index.html for SPA routing
  return new Response(Bun.file(distDir + '/index.html'))
})

export default {
  port: 3000,
  fetch: app.fetch,
}
