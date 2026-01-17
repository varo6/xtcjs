import { formatSize } from '../utils/format'
import type { ConversionResult } from '../lib/converter'

interface ResultsProps {
  results: ConversionResult[]
  onDownload: (result: ConversionResult) => void
  onPreview: (result: ConversionResult) => void
}

export function Results({ results, onDownload, onPreview }: ResultsProps) {
  if (results.length === 0) {
    return null
  }

  return (
    <section className="results-section">
      <div className="section-header">
        <h2>Complete</h2>
      </div>
      <div className="results-grid">
        {results.map((result, idx) => (
          <div
            key={`${result.name}-${idx}`}
            className={`result-item${result.error ? ' error' : ''}`}
          >
            <div>
              <span className="name">{result.name}</span>
              {result.error ? (
                <div className="info">Error: {result.error}</div>
              ) : (
                <div className="info">
                  {result.pageCount} pages &middot; {formatSize(result.size || 0)}
                </div>
              )}
            </div>
            {!result.error && (
              <div className="result-actions">
                <button
                  className="btn-preview"
                  onClick={() => onPreview(result)}
                >
                  Preview
                </button>
                <button
                  className="btn-download"
                  onClick={() => onDownload(result)}
                >
                  Download
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

export function downloadResult(result: ConversionResult): void {
  if (!result.data) return

  const blob = new Blob([result.data], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = result.name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
