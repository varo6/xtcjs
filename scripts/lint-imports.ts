import { Glob } from 'bun'

interface ImportBoundary {
  module: RegExp
  owner: string
  useInstead: string
}

export const BOUNDARIES: ImportBoundary[] = [
  {
    module: /^pdfjs-dist(\/|$)/,
    owner: 'src/lib/pdfjs.ts',
    useInstead: 'loadPdfDocument() and the PDFDocumentProxy type from src/lib/pdfjs.ts, which own the worker, its fallback and the WASM decoder URL',
  },
]

export interface SourceFile {
  path: string
  text: string
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g

export function findViolations(files: SourceFile[]): string[] {
  const violations: string[] = []
  for (const file of files) {
    const lines = file.text.split('\n')
    lines.forEach((line, index) => {
      for (const [, specifier] of line.matchAll(SPECIFIER)) {
        for (const boundary of BOUNDARIES) {
          if (file.path === boundary.owner || !boundary.module.test(specifier)) continue
          violations.push(
            `${file.path}:${index + 1} imports '${specifier}'. Only ${boundary.owner} may import it; use ${boundary.useInstead}.`
          )
        }
      }
    })
  }
  return violations
}

async function readSources(root: string): Promise<SourceFile[]> {
  const files: SourceFile[] = []
  for (const pattern of ['src/**/*.{ts,tsx}', 'server/**/*.ts']) {
    for await (const path of new Glob(pattern).scan(root)) {
      files.push({ path, text: await Bun.file(`${root}/${path}`).text() })
    }
  }
  return files
}

if (import.meta.main) {
  const violations = findViolations(await readSources(process.cwd()))
  for (const violation of violations) console.error(violation)
  process.exit(violations.length > 0 ? 1 : 0)
}
