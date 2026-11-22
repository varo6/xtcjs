import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { api } from './api'

const app = new Hono()

app.use(
  '/api/*',
  cors({
    origin: ['https://xtcjs.app', 'https://www.xtcjs.app'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  })
)

app.route('/api', api)

app.get('/', (c) => c.json({ status: 'ok', service: 'xtcjs-api' }))

export default {
  port: Number(process.env.PORT) || 3000,
  fetch: app.fetch,
}
