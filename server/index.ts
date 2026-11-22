import { Hono } from 'hono'
import { api } from './api'

const app = new Hono()

app.route('/api', api)

app.get('*', async (c) => {
  const path = new URL(c.req.url).pathname
  const distDir = import.meta.dir + '/../dist'

  let file = Bun.file(distDir + path)
  if (await file.exists()) {
    return new Response(file)
  }

  return new Response(Bun.file(distDir + '/index.html'))
})

export default {
  port: 3000,
  fetch: app.fetch,
}
