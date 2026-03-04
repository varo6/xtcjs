import { formatSize } from '../utils/format'
import type { StoredResult } from '../hooks/useStoredResults'

interface ResultsProps {
  results: StoredResult[]
  onDownload: (result: StoredResult) => void | Promise<void>
  onPreview: (result: StoredResult) => void | Promise<void>
  onDownloadAll?: () => void | Promise<void>
  downloadAllCount?: number
  onClear?: () => void | Promise<void>
}

export function Results({
  results,
  onDownload,
  onPreview,
  onDownloadAll,
  downloadAllCount = 0,
  onClear,
}: ResultsProps) {
  if (results.length === 0) {
    return null
  }

  return (
    <section className="results-section">
      <div className="section-header">
        <h2>Complete</h2>
        {(onDownloadAll || onClear) && (
          <div className="results-header-actions">
            {onDownloadAll && downloadAllCount > 0 && (
              <button className="btn-download-results-zip" onClick={onDownloadAll}>
                Download All ({downloadAllCount})
              </button>
            )}
            {onClear && (
              <button className="btn-clear-results" onClick={onClear}>
                Clear Results
              </button>
            )}
          </div>
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
