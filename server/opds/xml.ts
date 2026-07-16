import type { LibraryBook } from './types'

interface RootFeedOptions {
  baseUrl: string
  updated: string
}

interface BooksFeedOptions {
  baseUrl: string
  books: LibraryBook[]
  page: number
  pageSize: number
  total: number
  query: string
  updated: string
  format: OpdsOutputFormat
}

export type OpdsOutputFormat = 'xtc' | 'xtch'

export const NAVIGATION_FEED_TYPE = 'application/atom+xml;profile=opds-catalog;kind=navigation'
export const ACQUISITION_FEED_TYPE = 'application/atom+xml;profile=opds-catalog;kind=acquisition'

export function getAcquisitionMediaType(format: OpdsOutputFormat): string {
  return format === 'xtch' ? 'application/x-xtch+zip' : 'application/x-xtc+zip'
}

export function createRootFeedXml({ baseUrl, updated }: RootFeedOptions): string {
  const booksUrl = `${baseUrl}/opds/books`
  return atomFeed([
    '<title>XTCJS Library</title>',
    '<id>urn:xtcjs:opds:root</id>',
    `<updated>${escapeXml(updated)}</updated>`,
    `<link rel="self" href="${escapeAttr(`${baseUrl}/opds`)}" type="${NAVIGATION_FEED_TYPE}"/>`,
    `<entry><title>Books</title><id>urn:xtcjs:opds:books</id><updated>${escapeXml(updated)}</updated><link href="${escapeAttr(booksUrl)}" type="${NAVIGATION_FEED_TYPE}"/></entry>`,
  ])
}

export function createBooksFeedXml(options: BooksFeedOptions): string {
  const { baseUrl, books, page, pageSize, total, query, updated, format } = options
  const parts: string[] = [
    '<title>XTCJS Books</title>',
    '<id>urn:xtcjs:opds:books</id>',
    `<updated>${escapeXml(updated)}</updated>`,
    `<link rel="self" href="${escapeAttr(buildBooksUrl(baseUrl, page, query))}" type="${ACQUISITION_FEED_TYPE}"/>`,
    `<link rel="search" href="${escapeAttr(`${baseUrl}/opds/books?q={searchTerms}`)}" type="${ACQUISITION_FEED_TYPE}"/>`,
  ]

  if (page > 1) {
    parts.push(`<link rel="previous" href="${escapeAttr(buildBooksUrl(baseUrl, page - 1, query))}" type="${ACQUISITION_FEED_TYPE}"/>`)
  }
  if (page * pageSize < total) {
    parts.push(`<link rel="next" href="${escapeAttr(buildBooksUrl(baseUrl, page + 1, query))}" type="${ACQUISITION_FEED_TYPE}"/>`)
  }

  for (const book of books) {
    parts.push(createBookEntry(baseUrl, book, format))
  }

  return atomFeed(parts)
}

function createBookEntry(baseUrl: string, book: LibraryBook, format: OpdsOutputFormat): string {
  const author = book.author
    ? `<author><name>${escapeXml(book.author)}</name></author>`
    : ''
  return [
    '<entry>',
    `<title>${escapeXml(book.title)}</title>`,
    `<id>urn:xtcjs:book:${escapeXml(book.id)}</id>`,
    `<updated>${escapeXml(book.updated)}</updated>`,
    author,
    `<link rel="http://opds-spec.org/acquisition/open-access" href="${escapeAttr(`${baseUrl}/opds/books/${encodeURIComponent(book.id)}/download`)}" type="${getAcquisitionMediaType(format)}"/>`,
    '</entry>',
  ].join('')
}

function atomFeed(parts: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">',
    ...parts,
    '</feed>',
  ].join('')
}

function buildBooksUrl(baseUrl: string, page: number, query: string): string {
  const params = new URLSearchParams()
  if (page > 1 || query) params.set('page', String(page))
  if (query) params.set('q', query)
  const suffix = params.toString()
  return `${baseUrl}/opds/books${suffix ? `?${suffix}` : ''}`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return escapeXml(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
