import { Hono } from 'hono'
import { api } from './api'

const app = new Hono()

// Mount API routes under /api
app.route('/api', api)

export default app
