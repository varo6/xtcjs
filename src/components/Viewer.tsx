import { useState, useEffect, useCallback } from 'react'

interface ViewerProps {
  pages: string[]
  onClose: () => void
}

export function Viewer({ pages, onClose }: ViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isRotated, setIsRotated] = useState(false)

  const goToPage = useCallback((index: number) => {
    if (index >= 0 && index < pages.length) {
      setCurrentIndex(index)
    }
  }, [pages.length])

  const toggleRotate = useCallback(() => {
    setIsRotated(prev => !prev)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex, goToPage, onClose, toggleRotate])

  useEffect(() => {
    setCurrentIndex(0)
    setIsRotated(false)
  }, [pages])

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
        <div
          className="viewer-track"
          style={{ transform: `translateX(-${currentIndex * 100}%)` }}
        >
          {pages.map((src, i) => (
            <div key={i} className="viewer-page">
              <img src={src} alt={`Page ${i + 1}`} />
            </div>
          ))}
        </div>
      </div>
      <div className="viewer-thumbnails">
        <div className="thumbnail-track">
          {pages.map((src, i) => (
            <button
              key={i}
              className={`thumbnail${i === currentIndex ? ' active' : ''}`}
              onClick={() => goToPage(i)}
            >
              <img src={src} alt={`Page ${i + 1}`} />
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
