import { expect, test } from 'bun:test'
import { findViolations } from './lint-imports'

test('rejects pdfjs-dist imports outside src/lib/pdfjs.ts and names the replacement', () => {
  const violations = findViolations([
    { path: 'src/lib/merge.ts', text: "import * as pdfjsLib from 'pdfjs-dist'" },
    { path: 'src/lib/split.ts', text: "\nimport pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'" },
    { path: 'src/lib/metadata/pdf-outline.ts', text: "import type { PDFDocumentProxy } from 'pdfjs-dist'" },
    { path: 'src/lib/converter.ts', text: "const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')" },
  ])

  expect(violations).toHaveLength(4)
  expect(violations[0]).toStartWith("src/lib/merge.ts:1 imports 'pdfjs-dist'.")
  expect(violations[1]).toStartWith('src/lib/split.ts:2 ')
  expect(violations[0]).toContain('use loadPdfDocument()')
})

test('lets the owning module import pdfjs-dist', () => {
  expect(findViolations([
    { path: 'src/lib/pdfjs.ts', text: "const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')" },
    { path: 'src/lib/converter.ts', text: "import { loadPdfDocument } from './pdfjs'" },
  ])).toEqual([])
})
