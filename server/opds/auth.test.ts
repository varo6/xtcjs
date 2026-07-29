import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { createOpdsAuth } from './auth'
import { opdsRoutes } from './routes'

function authorization(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`
}

test('allows OPDS requests when authentication is not configured', async () => {
  const app = new Hono()
  app.use('*', createOpdsAuth())
  app.get('/', (c) => c.text('catalog'))

  expect((await app.request('/')).status).toBe(200)
})

test('requires matching OPDS Basic Auth credentials when configured', async () => {
  const app = new Hono()
  app.use('*', createOpdsAuth({ username: 'reader', password: 'secret' }))
  app.get('/', (c) => c.text('catalog'))

  const unauthorized = await app.request('/')
  const authorized = await app.request('/', {
    headers: { Authorization: authorization('reader', 'secret') },
  })

  expect(unauthorized.status).toBe(401)
  expect(unauthorized.headers.get('WWW-Authenticate')).toContain('Basic')
  expect(authorized.status).toBe(200)
})

test('marks OPDS responses as private and non-sniffable', async () => {
  const response = await opdsRoutes.request('http://localhost/opds')

  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
})
