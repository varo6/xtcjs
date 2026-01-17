import { formatSize } from '../utils/format'

interface FileListProps {
  files: File[]
  onRemove: (index: number) => void
  onConvert: () => void
  isConverting: boolean
}

export function FileList({ files, onRemove, onConvert, isConverting }: FileListProps) {
  if (files.length === 0) {
    return null
  }

  return (
    <section className="file-list">
      <div className="section-header">
        <h2>Files</h2>
        <span className="badge">{files.length}</span>
      </div>
      <div className="files-grid">
        {files.map((file, idx) => (
          <div key={`${file.name}-${idx}`} className="file-item">
            <span className="name">{file.name}</span>
            <span className="size">{formatSize(file.size)}</span>
            <button
              className="remove"
              onClick={() => onRemove(idx)}
              aria-label="Remove file"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
      <button
        className={`btn-convert${isConverting ? ' loading' : ''}`}
        onClick={onConvert}
        disabled={isConverting}
      >
        <span>Convert</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </button>
    </section>
  )
}
