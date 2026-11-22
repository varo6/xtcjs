import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Viewer } from './Viewer'

const pages = ['data:image/png;base64,first', 'data:image/png;base64,second']

test('labels sparse previews as samples and explains the output page count', () => {
  const markup = renderToStaticMarkup(<Viewer pages={pages} totalPages={120} onClose={() => {}} />)
  expect(markup).toContain('<h2>Preview samples</h2>')
  expect(markup).toContain('role="note"')
  expect(markup).toContain('may skip pages')
  expect(markup).toContain('not the full reading order')
  expect(markup).toContain('120 output pages')
  expect(markup.match(/alt="Sample 1"/g)).toHaveLength(2)
  expect(markup).toContain('alt="Sample 2"')
  expect(markup).not.toContain('alt="Page ')
  expect(markup).toContain('aria-label="Next sample"')
})

test('keeps ordinary page labels for full previews and callers without an output count', () => {
  for (const totalPages of [undefined, 2]) {
    const markup = renderToStaticMarkup(<Viewer pages={pages} totalPages={totalPages} onClose={() => {}} />)
    expect(markup).toContain('<h2>Preview</h2>')
    expect(markup).toContain('alt="Page 1"')
    expect(markup).toContain('alt="Page 2"')
    expect(markup).toContain('aria-label="Next page"')
    expect(markup).not.toContain('Preview samples')
    expect(markup).not.toContain('role="note"')
  }
})

test('does not render an empty preview even when an output count is supplied', () => {
  expect(renderToStaticMarkup(<Viewer pages={[]} totalPages={120} onClose={() => {}} />)).toBe('')
})
