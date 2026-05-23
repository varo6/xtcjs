import { Hono } from 'hono'
import { ACQUISITION_FEED_TYPE, NAVIGATION_FEED_TYPE, createBooksFeedXml, createRootFeedXml } from './xml'
import { opdsService } from './service'

export const opdsRoutes = new Hono()

opdsRoutes.get('/', (c) => {
  const xml = createRootFeedXml({
    baseUrl: getBaseUrl(c.req.url),
    updated: new Date().toISOString(),
  })

  return new Response(xml, {
    headers: {
      'Content-Type': NAVIGATION_FEED_TYPE,
    },
  })
})

opdsRoutes.get('/books', async (c) => {
  const page = Math.max(1, Number.parseInt(c.req.query('page') || '1', 10) || 1)
  const query = c.req.query('q') || ''
  const books = await opdsService.search(query)
  const pageSize = opdsService.config.pageSize
  const pageBooks = books.slice((page - 1) * pageSize, page * pageSize)

  const xml = createBooksFeedXml({
    baseUrl: getBaseUrl(c.req.url),
    books: pageBooks,
    page,
    pageSize,
    total: books.length,
    query,
    updated: new Date().toISOString(),
  })

  return new Response(xml, {
    headers: {
      'Content-Type': ACQUISITION_FEED_TYPE,
    },
  })
})

opdsRoutes.get('/books/:id/download', async (c) => {
  const book = await opdsService.getBook(c.req.param('id'))
  if (!book) {
    return c.json({ error: 'Book not found' }, 404)
  }

  const cached = await opdsService.getConvertedBook(book)
  const file = Bun.file(cached.path)
  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${escapeHeaderValue(cached.filename)}"`,
  })
  if (cached.size > 0) {
    headers.set('Content-Length', String(cached.size))
  }

  return new Response(file, { headers })
})

export const opdsApiRoutes = new Hono()

opdsApiRoutes.get('/status', async (c) => {
  return c.json(await opdsService.getStatus())
})

opdsApiRoutes.post('/rescan', async (c) => {
  const books = await opdsService.rescan()
  return c.json({ success: true, bookCount: books.length })
})

function getBaseUrl(url: string): string {
  const parsed = new URL(url)
  return `${parsed.protocol}//${parsed.host}`
}

function escapeHeaderValue(value: string): string {
  return value.replace(/["\\]/g, '_')
}
