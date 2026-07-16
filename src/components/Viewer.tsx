import { useState, useEffect, useCallback, useMemo, useRef, useEffectEvent } from 'react'

interface ViewerProps {
  pages: string[]
  onClose: () => void
}

const MAX_THUMBNAILS = 60
const FOCUS_WINDOW = 12

function getThumbnailIndices(currentIndex: number, totalPages: number): number[] {
  if (totalPages <= MAX_THUMBNAILS) {
    return Array.from({ length: totalPages }, (_, index) => index)
  }

  const stride = Math.max(1, Math.ceil(totalPages / (MAX_THUMBNAILS - (FOCUS_WINDOW * 2 + 2))))
  const indices = new Set<number>([0, totalPages - 1])

  for (let index = 0; index < totalPages; index += stride) {
    indices.add(index)
  }

  const start = Math.max(0, currentIndex - FOCUS_WINDOW)
  const end = Math.min(totalPages - 1, currentIndex + FOCUS_WINDOW)
  for (let index = start; index <= end; index++) {
    indices.add(index)
  }

  return Array.from(indices).sort((a, b) => a - b)
}

export function Viewer({ pages, onClose }: ViewerProps) {
  const previousPagesRef = useRef(pages)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isRotated, setIsRotated] = useState(false)
  const thumbnailIndices = useMemo(
    () => getThumbnailIndices(currentIndex, pages.length),
    [currentIndex, pages.length]
  )

  const goToPage = useCallback((index: number) => {
    if (index >= 0 && index < pages.length) {
      setCurrentIndex(index)
    }
  }, [pages.length])

  const toggleRotate = useCallback(() => {
    setIsRotated(prev => !prev)
  }, [])

  if (pages !== previousPagesRef.current) {
    previousPagesRef.current = pages
    setCurrentIndex(0)
    setIsRotated(false)
  }

  const handleViewerKeyDown = useEffectEvent((e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowLeft':
        goToPage(currentIndex - 1)
        break
      case 'ArrowRight':
        goToPage(currentIndex + 1)
        break
      case 'Escape':
        onClose()
        break
      case 'r':
      case 'R':
        toggleRotate()
        break
    }
  })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      handleViewerKeyDown(e)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (pages.length === 0) {
    return null
  }

  return (
    <section className={`viewer-section${isRotated ? ' rotated' : ''}`}>
      <div className="viewer-header">
        <div className="section-header">
          <h2>Preview</h2>
          <span className="badge">{currentIndex + 1} / {pages.length}</span>
        </div>
        <div className="viewer-controls">
          <button
            type="button"
            className="viewer-btn"
            onClick={toggleRotate}
            aria-label="Rotate view"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
            </svg>
          </button>
          <div className="viewer-separator" />
          <button
            type="button"
            className="viewer-btn"
            onClick={() => goToPage(currentIndex - 1)}
            disabled={currentIndex === 0}
            aria-label="Previous page"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <button
            type="button"
            className="viewer-btn"
            onClick={() => goToPage(currentIndex + 1)}
            disabled={currentIndex === pages.length - 1}
            aria-label="Next page"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
          <button
            type="button"
            className="viewer-btn viewer-btn-close"
            onClick={onClose}
            aria-label="Close viewer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="viewer-container">
        <div className="viewer-page">
          <img
            src={pages[currentIndex]}
            alt={`Page ${currentIndex + 1}`}
            loading="eager"
            decoding="async"
          />
        </div>
      </div>
      <div className="viewer-thumbnails">
        <div className="thumbnail-track">
          {thumbnailIndices.map((i) => (
            <button
              key={pages[i] || i}
              type="button"
              className={`thumbnail${i === currentIndex ? ' active' : ''}`}
              onClick={() => goToPage(i)}
            >
              <img
                src={pages[i]}
                alt={`Page ${i + 1}`}
                loading="lazy"
                decoding="async"
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
