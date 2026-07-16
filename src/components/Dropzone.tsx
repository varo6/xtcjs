import { useCallback, useRef, useState } from 'react'

interface DropzoneProps {
  onFiles: (files: File[]) => void
  fileType?: 'cbz' | 'pdf' | 'image' | 'video' | 'xtc'
  multiple?: boolean
}

export function Dropzone({ onFiles, fileType = 'cbz', multiple = true }: DropzoneProps) {
  const [isDragover, setIsDragover] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const accept = fileType === 'pdf'
    ? '.pdf,.PDF'
    : (fileType === 'image'
      ? '.jpg,.jpeg,.png,.webp,.bmp,.gif'
      : (fileType === 'video'
        ? '.mp4,.webm,.mkv,.avi,.mov'
        : (fileType === 'xtc' ? '.xtc,.xtch' : '.cbz,.CBZ,.cbr,.CBR')))
  const label = fileType === 'pdf'
    ? 'PDF'
    : (fileType === 'image'
      ? 'Image'
      : (fileType === 'video' ? 'Video' : (fileType === 'xtc' ? 'XTC/XTCH' : 'CBZ/CBR')))

  const filterFiles = useCallback((files: FileList) => {
    if (fileType === 'pdf') {
      return Array.from(files).filter(f =>
        f.name.toLowerCase().endsWith('.pdf')
      )
    }
    if (fileType === 'image') {
      return Array.from(files).filter(f =>
        /\.(jpg|jpeg|png|webp|bmp|gif)$/i.test(f.name)
      )
    }
    if (fileType === 'video') {
      return Array.from(files).filter(f =>
        /\.(mp4|webm|mkv|avi|mov)$/i.test(f.name)
      )
    }
    if (fileType === 'xtc') {
      return Array.from(files).filter(f =>
        /\.(xtc|xtch)$/i.test(f.name)
      )
    }
    // Accept both .cbz and .cbr for comic book type
    return Array.from(files).filter(f => {
      const name = f.name.toLowerCase()
      return name.endsWith('.cbz') || name.endsWith('.cbr')
    })
  }, [fileType])

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
      <button
        type="button"
        className={`dropzone${isDragover ? ' dragover' : ''}`}
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
      </button>
      <input
        type="file"
        ref={fileInputRef}
        accept={accept}
        multiple={multiple}
        aria-label={`Choose ${label} files`}
        hidden
        onChange={handleFileChange}
      />
    </section>
  )
}
