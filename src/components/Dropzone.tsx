import { useCallback, useRef, useState } from 'react'

interface DropzoneProps {
  onFiles: (files: File[]) => void
  fileType?: 'cbz' | 'pdf'
}

export function Dropzone({ onFiles, fileType = 'cbz' }: DropzoneProps) {
  const [isDragover, setIsDragover] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const extension = fileType === 'pdf' ? '.pdf' : '.cbz'
  const accept = fileType === 'pdf' ? '.pdf,.PDF' : '.cbz,.CBZ'
  const label = fileType === 'pdf' ? 'PDF' : 'CBZ'

  const filterFiles = useCallback((files: FileList) => {
    return Array.from(files).filter(f =>
      f.name.toLowerCase().endsWith(extension)
    )
  }, [extension])

  const handleClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fileInputRef.current?.click()
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragover(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragover(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragover(false)
    if (e.dataTransfer?.files) {
      const filtered = filterFiles(e.dataTransfer.files)
      if (filtered.length > 0) {
        onFiles(filtered)
      }
    }
  }, [onFiles, filterFiles])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filtered = filterFiles(e.target.files)
      if (filtered.length > 0) {
        onFiles(filtered)
      }
      e.target.value = ''
    }
  }, [onFiles, filterFiles])

  return (
    <section className="dropzone-wrapper">
      <div
        className={`dropzone${isDragover ? ' dragover' : ''}`}
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="dropzone-inner">
          <div className="dropzone-icon">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="8" y="8" width="32" height="32" rx="2"/>
              <path d="M16 28l8-8 8 8"/>
              <path d="M24 20v16"/>
            </svg>
          </div>
          <div className="dropzone-text">
            <span className="dropzone-primary">Drop {label} files</span>
            <span className="dropzone-secondary">or click to browse</span>
          </div>
        </div>
        <input
          type="file"
          ref={fileInputRef}
          accept={accept}
          multiple
          hidden
          onChange={handleFileChange}
        />
      </div>
    </section>
  )
}
