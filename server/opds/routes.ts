import { Hono, type MiddlewareHandler } from 'hono'
import {
  ACQUISITION_FEED_TYPE,
  NAVIGATION_FEED_TYPE,
  createBooksFeedXml,
  createRootFeedXml,
  getAcquisitionMediaType,
  type OpdsOutputFormat,
} from './xml'
import { opdsService } from './service'
import { createOpdsAuth } from './auth'
import { TaskQueueFullError } from './task-queue'

const privateResponseHeaders: MiddlewareHandler = async (c, next) => {
  await next()
  c.header('Cache-Control', 'private, no-store')
  c.header('X-Content-Type-Options', 'nosniff')
}

export const opdsRoutes = new Hono()
opdsRoutes.use('*', privateResponseHeaders)
opdsRoutes.use('*', createOpdsAuth(opdsService.config.auth))

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
    format: getOutputFormat(),
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

  let cached
  try {
    cached = await opdsService.getConvertedBook(book)
  } catch (error) {
    if (error instanceof TaskQueueFullError) {
      c.header('Retry-After', '30')
      return c.json({ error: error.message }, 503)
    }
    throw error
  }
  const file = Bun.file(cached.path)
  const headers = new Headers({
    'Content-Type': getAcquisitionMediaType(getOutputFormat()),
    'Content-Disposition': `attachment; filename="${escapeHeaderValue(cached.filename)}"`,
  })
  if (cached.size > 0) {
    headers.set('Content-Length', String(cached.size))
  }

  return new Response(file, { headers })
})

export const opdsApiRoutes = new Hono()
opdsApiRoutes.use('*', privateResponseHeaders)
opdsApiRoutes.use('*', createOpdsAuth(opdsService.config.auth))

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

function getOutputFormat(): OpdsOutputFormat {
  return opdsService.config.conversion.is2bit ? 'xtch' : 'xtc'
}
