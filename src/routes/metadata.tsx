import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Dropzone } from '../components/Dropzone'
import { Viewer } from '../components/Viewer'
import { parseXtcFile, type ParsedXtc, extractXtcPages } from '../lib/xtc-reader'
import { buildXtcFromBuffers } from '../lib/xtc-format'
import type { BookMetadata, TocEntry } from '../lib/metadata'

export const Route = createFileRoute('/metadata')({
  component: MetadataEditor,
})

function MetadataEditor() {
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedXtc | null>(null)
  const [metadata, setMetadata] = useState<BookMetadata>({ toc: [] })

  const [previewPages, setPreviewPages] = useState<string[]>([])
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  const handleFileDrop = async (files: File[]) => {
    if (files.length === 0) return
    const selected = files[0]
    setFile(selected)
    setIsProcessing(true)

    try {
      const buffer = await selected.arrayBuffer()
      const parsedData = await parseXtcFile(buffer)
      setParsed(parsedData)
      setMetadata(parsedData.metadata || { toc: [] })
    } catch {
      alert('Failed to parse XTC/XTCH file. Ensure it is a valid format.')
      setFile(null)
      setParsed(null)
    } finally {
      setIsProcessing(false)
    }
  }

  const handlePreview = async () => {
    if (!parsed || !file) return

    setIsProcessing(true)
    try {
      const canvases = await extractXtcPages(await file.arrayBuffer())
      const urls = canvases.map((canvas) => canvas.toDataURL('image/png'))
      setPreviewPages(urls)
      setIsPreviewOpen(true)
    } catch {
      alert('Failed to generate preview.')
    } finally {
      setIsProcessing(false)
    }
  }

  const validateToc = (): boolean => {
    for (let i = 0; i < metadata.toc.length; i++) {
      const current = metadata.toc[i]
      if (current.startPage > current.endPage) {
        alert(`Chapter "${current.title}" has invalid range (${current.startPage} > ${current.endPage}).`)
        return false
      }

      for (let j = i + 1; j < metadata.toc.length; j++) {
        const other = metadata.toc[j]
        if (current.startPage <= other.endPage && current.endPage >= other.startPage) {
          alert(
            `Chapter overlap detected:\n"${current.title}" (${current.startPage}-${current.endPage})\n` +
            `overlaps with\n"${other.title}" (${other.startPage}-${other.endPage}).`
          )
          return false
        }
      }
    }

    return true
  }

  const handleSave = async () => {
    if (!parsed || !file) return
    if (!validateToc()) return

    setIsProcessing(true)
    try {
      const repacked = await buildXtcFromBuffers(parsed.pageData, {
        metadata,
        is2bit: parsed.header.is2bit,
      })

      const extension = parsed.header.is2bit ? '.xtch' : '.xtc'
      const baseName = file.name.replace(/\.[^/.]+$/, '')
      const outputName = `${baseName}_edited${extension}`

      const blob = new Blob([repacked], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = outputName
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    } catch {
      alert('Failed to repack XTC/XTCH file.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleAddChapter = () => {
    const maxPage = parsed?.header.pageCount || 1
    setMetadata((prev) => ({
      ...prev,
      toc: [...prev.toc, { title: 'New Chapter', startPage: 1, endPage: maxPage }],
    }))
  }

  const handleRemoveChapter = (index: number) => {
    setMetadata((prev) => {
      const next = [...prev.toc]
      next.splice(index, 1)
      return { ...prev, toc: next }
    })
  }

  const handleChapterChange = (index: number, field: keyof TocEntry, value: string | number) => {
    setMetadata((prev) => {
      const next = [...prev.toc]
      next[index] = { ...next[index], [field]: value }
      return { ...prev, toc: next }
    })
  }

  const handleMoveChapter = (index: number, direction: 'up' | 'down') => {
    setMetadata((prev) => {
      const next = [...prev.toc]
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= next.length) {
        return prev
      }
      const current = next[index]
      next[index] = next[targetIndex]
      next[targetIndex] = current
      return { ...prev, toc: next }
    })
  }

  return (
    <div className="content-section metadata-page" style={{ gridColumn: '1 / -1' }}>
      <div className="section-header" style={{ marginBottom: 'var(--space-xl)' }}>
        <h2 className="metadata-title">Metadata Editor (XTC/XTCH)</h2>
      </div>

      {!file && (
        <div className="dropzone-wrapper" style={{ minHeight: '300px' }}>
          <Dropzone onFiles={handleFileDrop} fileType="xtc" multiple={false} />
        </div>
      )}

      {isProcessing && (
        <div className="metadata-status">Processing... please wait.</div>
      )}

      {file && parsed && !isProcessing && (
        <div className="metadata-editor">
          <section className="metadata-card">
            <h3>File Info</h3>
            <p><strong>Name:</strong> {file.name}</p>
            <p><strong>Pages:</strong> {parsed.header.pageCount}</p>
            <p><strong>Type:</strong> {parsed.header.is2bit ? 'XTCH (2-bit)' : 'XTC (1-bit)'}</p>

            <div className="metadata-actions">
              <button type="button" className="btn-preview" onClick={handlePreview}>Preview</button>
              <button type="button" className="btn-download" onClick={handleSave}>Save & Download</button>
              <button
                type="button"
                className="btn-clear-results"
                onClick={() => {
                  setFile(null)
                  setParsed(null)
                  setMetadata({ toc: [] })
                }}
              >
                Close File
              </button>
            </div>
          </section>

          <section className="metadata-card">
            <h3>Book Metadata</h3>
            <div className="metadata-fields">
              <label>
                <strong>Title:</strong>
                <input
                  type="text"
                  value={metadata.title || ''}
                  onChange={(e) => setMetadata((prev) => ({ ...prev, title: e.target.value }))}
                  maxLength={127}
                  placeholder="e.g. My Awesome Manga"
                />
              </label>

              <label>
                <strong>Author:</strong>
                <input
                  type="text"
                  value={metadata.author || ''}
                  onChange={(e) => setMetadata((prev) => ({ ...prev, author: e.target.value }))}
                  maxLength={111}
                  placeholder="e.g. John Doe"
                />
              </label>
            </div>
          </section>

          <section className="metadata-card">
            <div className="metadata-chapter-header">
              <h3>Chapters (TOC)</h3>
              <button type="button" className="btn-preview" onClick={handleAddChapter}>+ Add Chapter</button>
            </div>

            {metadata.toc.length === 0 ? (
              <p className="metadata-empty">No chapters defined.</p>
            ) : (
              <div className="metadata-chapters">
                {metadata.toc.map((entry, idx) => (
                  <div key={`${idx}-${entry.title}`} className="metadata-chapter-row">
                    <label className="chapter-title-input">
                      <span>Chapter Title (max 79 chars)</span>
                      <input
                        type="text"
                        value={entry.title}
                        onChange={(e) => handleChapterChange(idx, 'title', e.target.value)}
                        maxLength={79}
                      />
                    </label>

                    <label>
                      <span>Start Pg</span>
                      <input
                        type="number"
                        min={1}
                        max={parsed.header.pageCount}
                        value={entry.startPage}
                        onChange={(e) => handleChapterChange(idx, 'startPage', parseInt(e.target.value, 10) || 1)}
                      />
                    </label>

                    <label>
                      <span>End Pg</span>
                      <input
                        type="number"
                        min={1}
                        max={parsed.header.pageCount}
                        value={entry.endPage}
                        onChange={(e) => handleChapterChange(idx, 'endPage', parseInt(e.target.value, 10) || 1)}
                      />
                    </label>

                    <div className="chapter-controls">
                      <button
                        type="button"
                        className="btn-preview"
                        onClick={() => handleMoveChapter(idx, 'up')}
                        disabled={idx === 0}
                        title="Move Up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn-preview"
                        onClick={() => handleMoveChapter(idx, 'down')}
                        disabled={idx === metadata.toc.length - 1}
                        title="Move Down"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn-preview btn-delete-meta"
                        onClick={() => handleRemoveChapter(idx)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {isPreviewOpen && previewPages.length > 0 && (
        <Viewer pages={previewPages} onClose={() => setIsPreviewOpen(false)} />
      )}
    </div>
  )
}
