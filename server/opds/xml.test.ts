import { describe, expect, test } from 'bun:test'
import { createBooksFeedXml, createRootFeedXml } from './xml'
import type { LibraryBook } from './types'

const books: LibraryBook[] = [
  {
    id: 'book-1',
    relativePath: 'Series/A&B.cbz',
    absolutePath: '/library/Series/A&B.cbz',
    title: 'A&B <Vol 1>',
    author: 'One & Two',
    size: 1234,
    mtimeMs: 1000,
    updated: '2026-05-23T00:00:00.000Z',
  },
  {
    id: 'book-2',
    relativePath: 'Series/Second.cbz',
    absolutePath: '/library/Series/Second.cbz',
    title: 'Second',
    size: 2345,
    mtimeMs: 2000,
    updated: '2026-05-23T00:01:00.000Z',
  },
]

describe('OPDS XML generation', () => {
  test('root feed exposes a navigation catalog link', () => {
    const xml = createRootFeedXml({ baseUrl: 'http://localhost:3000', updated: '2026-05-23T00:00:00.000Z' })

    expect(xml).toContain('application/atom+xml;profile=opds-catalog;kind=navigation')
    expect(xml).toContain('href="http://localhost:3000/opds/books"')
    expect(xml).toContain('<title>XTCJS Library</title>')
  })

  test('books feed escapes values and emits acquisition links', () => {
    const xml = createBooksFeedXml({
      baseUrl: 'http://localhost:3000',
      books,
      page: 1,
      pageSize: 50,
      total: 2,
      query: '',
      updated: '2026-05-23T00:00:00.000Z',
      format: 'xtc',
    })

    expect(xml).toContain('<title>A&amp;B &lt;Vol 1&gt;</title>')
    expect(xml).toContain('<name>One &amp; Two</name>')
    expect(xml).toContain('rel="http://opds-spec.org/acquisition/open-access"')
    expect(xml).toContain('href="http://localhost:3000/opds/books/book-1/download"')
    expect(xml).toContain('type="application/x-xtc+zip"')
    expect(xml).toContain('href="http://localhost:3000/opds/books?q={searchTerms}"')
  })

  test('books feed advertises XTCH acquisitions for 2-bit output', () => {
    const xml = createBooksFeedXml({
      baseUrl: 'http://localhost:3000',
      books,
      page: 1,
      pageSize: 50,
      total: 2,
      query: '',
      updated: '2026-05-23T00:00:00.000Z',
      format: 'xtch',
    })

    expect(xml).toContain('type="application/x-xtch+zip"')
  })

  test('books feed emits previous and next pagination links', () => {
    const xml = createBooksFeedXml({
      baseUrl: 'http://localhost:3000',
      books,
      page: 2,
      pageSize: 2,
      total: 5,
      query: 'a&b',
      updated: '2026-05-23T00:00:00.000Z',
      format: 'xtc',
    })

    expect(xml).toContain('rel="previous"')
    expect(xml).toContain('href="http://localhost:3000/opds/books?page=1&amp;q=a%26b"')
    expect(xml).toContain('rel="next"')
    expect(xml).toContain('href="http://localhost:3000/opds/books?page=3&amp;q=a%26b"')
  })
})
