import { formatSize } from '../utils/format'
import type { StoredResult } from '../hooks/useStoredResults'

interface ResultsProps {
  results: StoredResult[]
  onDownload: (result: StoredResult) => void | Promise<void>
  onPreview: (result: StoredResult) => void | Promise<void>
  onClear?: () => void | Promise<void>
}

export function Results({ results, onDownload, onPreview, onClear }: ResultsProps) {
  if (results.length === 0) {
    return null
  }

  return (
    <section className="results-section">
      <div className="section-header">
        <h2>Complete</h2>
        {onClear && (
          <button className="btn-clear-results" onClick={onClear}>
            Clear Results
          </button>
        )}
      </div>
      <div className="results-grid">
        {results.map((result) => (
          <div
            key={result.id}
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
