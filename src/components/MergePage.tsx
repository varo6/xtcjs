import { useState, useCallback, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Viewer } from './Viewer'
import { formatSize } from '../utils/format'
import { setPendingFiles, arrayBufferToFile } from '../lib/file-transfer'
import {
  mergeFiles,
  detectFileType,
  validateSameType,
  type FileType,
  type OutputFormat,
  type MergeProgress,
} from '../lib/merge'
import {
  splitFile,
  parsePageRanges,
  calculateEqualParts,
  getPageCount,
  type SplitProgress,
  type PageRange,
} from '../lib/split'

type Mode = 'merge' | 'split'
type SplitMethod = 'ranges' | 'parts'

interface MergePageResult {
  name: string
  data: ArrayBuffer
  size: number
  pageCount: number
  pageImages?: string[]
  error?: string
  selected?: boolean
}

export function MergePage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('split')
  const [files, setFiles] = useState<File[]>([])
  const [detectedType, setDetectedType] = useState<FileType | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [results, setResults] = useState<MergePageResult[]>([])
  const [viewerPages, setViewerPages] = useState<string[]>([])
  const [typeError, setTypeError] = useState<string | null>(null)

  // Split options
  const [splitMethod, setSplitMethod] = useState<SplitMethod>('ranges')
  const [rangesInput, setRangesInput] = useState('')
  const [partsCount, setPartsCount] = useState(2)
  const [totalPages, setTotalPages] = useState<number | null>(null)

  // Output format: keep same type for CBZ/PDF, allow choice for XTC
  const [xtcOutputFormat, setXtcOutputFormat] = useState<OutputFormat>('xtc')
  
  // Determine actual output format based on input type
  const actualOutputFormat: OutputFormat = useMemo(() => {
    if (!detectedType) return 'cbz'
    if (detectedType === 'xtc') return xtcOutputFormat
    if (detectedType === 'pdf') return 'pdf'
    return 'cbz' // CBZ input stays as CBZ
  }, [detectedType, xtcOutputFormat])

  // Calculate expected output count for split
  const expectedOutputCount = useMemo(() => {
    if (mode !== 'split' || totalPages === null) return 0

    if (splitMethod === 'parts') {
      return Math.min(partsCount, totalPages)
    }

    try {
      const ranges = parsePageRanges(rangesInput, totalPages)
      return ranges.length
    } catch {
      return 0
    }
  }, [mode, splitMethod, partsCount, rangesInput, totalPages])

  const handleFiles = useCallback(async (newFiles: File[]) => {
    if (mode === 'split') {
      // Split mode: only accept one file
      const file = newFiles[0]
      if (!file) return

      const type = detectFileType(file)
      if (type === 'unknown') {
        setTypeError('Unsupported file type. Use CBZ, PDF, or XTC files.')
        return
      }

      setFiles([file])
      setDetectedType(type)
      setTypeError(null)
      setResults([])

      // Get page count for split
      try {
        const count = await getPageCount(file)
        setTotalPages(count)
      } catch (err) {
        setTypeError(err instanceof Error ? err.message : 'Failed to read file')
      }
    } else {
      // Merge mode: accept multiple files of same type
      const allFiles = [...files, ...newFiles]
      const validation = validateSameType(allFiles)

      if (!validation.valid) {
        setTypeError(validation.error || 'Invalid files')
        return
      }

      setFiles(allFiles)
      setDetectedType(validation.type)
      setTypeError(null)
      setResults([])
    }
  }, [mode, files])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => {
      const ext = f.name.toLowerCase().split('.').pop()
      return ['cbz', 'pdf', 'xtc'].includes(ext || '')
    })
    if (droppedFiles.length > 0) {
      handleFiles(droppedFiles)
    }
  }, [handleFiles])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(Array.from(e.target.files))
      e.target.value = ''
    }
  }, [handleFiles])

  const handleRemove = useCallback((index: number) => {
    setFiles(prev => {
      const newFiles = prev.filter((_, i) => i !== index)
      if (newFiles.length === 0) {
        setDetectedType(null)
        setTotalPages(null)
      }
      return newFiles
    })
    setResults([])
  }, [])

  const handleModeChange = useCallback((newMode: Mode) => {
    setMode(newMode)
    setFiles([])
    setDetectedType(null)
    setResults([])
    setTypeError(null)
    setTotalPages(null)
    setRangesInput('')
  }, [])

  const handleProcess = useCallback(async () => {
    if (files.length === 0) return

    setIsProcessing(true)
    setResults([])
    setProgress(0)
    setProgressText('Processing...')
    setPreviewUrl(null)

    try {
      if (mode === 'merge') {
        const result = await mergeFiles(files, actualOutputFormat, (p: MergeProgress) => {
          setProgressText(p.file)
          setProgress((p.fileIndex + p.pageProgress) / p.totalFiles)
          if (p.previewUrl) setPreviewUrl(p.previewUrl)
        })

        setResults([{ ...result, selected: true }])
      } else {
        // Split mode
        const file = files[0]
        let ranges: PageRange[]

        if (splitMethod === 'ranges') {
          ranges = parsePageRanges(rangesInput, totalPages!)
        } else {
          ranges = calculateEqualParts(totalPages!, partsCount)
        }

        const splitResults = await splitFile(file, ranges, actualOutputFormat, (p: SplitProgress) => {
          setProgressText(
            p.phase === 'extracting'
              ? 'Extracting pages...'
              : `Building part ${p.rangeIndex + 1}/${p.totalRanges}`
          )
          if (p.phase === 'extracting') {
            setProgress(p.pageProgress * 0.5)
          } else {
            setProgress(0.5 + (p.rangeIndex + p.pageProgress) / p.totalRanges * 0.5)
          }
          if (p.previewUrl) setPreviewUrl(p.previewUrl)
        })

        setResults(splitResults.map(r => ({ ...r, selected: true })))
      }

      setProgress(1)
      setProgressText('Complete')
    } catch (err) {
      console.error('Processing error:', err)
      setResults([{
        name: 'error',
        data: new ArrayBuffer(0),
        size: 0,
        pageCount: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
      }])
    } finally {
      setIsProcessing(false)
      setPreviewUrl(null)
    }
  }, [files, mode, actualOutputFormat, splitMethod, rangesInput, partsCount, totalPages])

  const handleDownload = useCallback((result: MergePageResult) => {
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
  }, [])

  const handlePreview = useCallback((result: MergePageResult) => {
    if (result.pageImages) {
      setViewerPages(result.pageImages)
    }
  }, [])

  const handleToggleSelect = useCallback((index: number) => {
    setResults(prev => prev.map((r, i) =>
      i === index ? { ...r, selected: !r.selected } : r
    ))
  }, [])

  const handleSelectAll = useCallback(() => {
    const allSelected = results.every(r => r.selected)
    setResults(prev => prev.map(r => ({ ...r, selected: !allSelected })))
  }, [results])

  const selectedResults = results.filter(r => r.selected && !r.error)
  const canMoveToConverter = selectedResults.length > 0 && (actualOutputFormat === 'cbz' || actualOutputFormat === 'pdf')

  const handleMoveToConverter = useCallback(() => {
    const filesToTransfer = selectedResults.map(r =>
      arrayBufferToFile(r.data, r.name)
    )
    setPendingFiles(filesToTransfer)
    navigate({ to: '/' })
  }, [selectedResults, navigate])

  const canProcess = mode === 'merge'
    ? files.length >= 2
    : files.length === 1 && totalPages !== null && (
        splitMethod === 'parts' || rangesInput.trim().length > 0
      )

  return (
    <>
      {/* Mode Toggle */}
      <section className="mode-toggle">
        <button
          className={mode === 'merge' ? 'active' : ''}
          onClick={() => handleModeChange('merge')}
        >
          Merge
        </button>
        <button
          className={mode === 'split' ? 'active' : ''}
          onClick={() => handleModeChange('split')}
        >
          Split
        </button>
      </section>

      {/* Dropzone */}
      <section className="dropzone-wrapper">
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => document.getElementById('merge-file-input')?.click()}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              document.getElementById('merge-file-input')?.click()
            }
          }}
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
              <span className="dropzone-primary">
                {mode === 'merge' ? 'Drop files to merge' : 'Drop a file to split'}
              </span>
              <span className="dropzone-secondary">
                CBZ, PDF, or XTC {mode === 'merge' ? '(same type only)' : ''}
              </span>
            </div>
          </div>
          <input
            id="merge-file-input"
            type="file"
            accept=".cbz,.CBZ,.pdf,.PDF,.xtc,.XTC"
            multiple={mode === 'merge'}
            hidden
            onChange={handleFileInput}
          />
        </div>
      </section>

      {/* Type Error */}
      {typeError && (
        <div className="type-error">
          <p>{typeError}</p>
        </div>
      )}

      {/* File List */}
      {files.length > 0 && (
        <section className="file-list">
          <div className="section-header">
            <h2>Files</h2>
            <span className="badge">{files.length}</span>
            {detectedType && (
              <span className="type-badge">{detectedType.toUpperCase()}</span>
            )}
          </div>
          <div className="files-grid">
            {files.map((file, idx) => (
              <div key={`${file.name}-${idx}`} className="file-item">
                <span className="name">{file.name}</span>
                <span className="size">{formatSize(file.size)}</span>
                <button
                  className="remove"
                  onClick={() => handleRemove(idx)}
                  aria-label="Remove file"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>

          {/* Page info for split mode */}
          {mode === 'split' && totalPages !== null && (
            <div className="page-info">
              Total pages: <strong>{totalPages}</strong>
            </div>
          )}
        </section>
      )}

      {/* Options Panel */}
      {files.length > 0 && (
        <aside className="options-panel">
          <div className="section-header">
            <h2>Options</h2>
          </div>

          {/* Output format - only for XTC input */}
          {detectedType === 'xtc' && (
            <div className="option">
              <label htmlFor="outputFormat">Output Format</label>
              <select
                id="outputFormat"
                value={xtcOutputFormat}
                onChange={(e) => setXtcOutputFormat(e.target.value as OutputFormat)}
              >
                <option value="xtc">XTC (E-Reader)</option>
                <option value="cbz">CBZ (Archive)</option>
              </select>
            </div>
          )}

          {/* Show output info for CBZ */}
          {detectedType === 'cbz' && (
            <div className="option">
              <label>Output Format</label>
              <div className="output-info">
                <span className="output-format-badge">CBZ</span>
                <span className="output-hint">
                  Move to converter to create XTC
                </span>
              </div>
            </div>
          )}

          {/* Show output info for PDF */}
          {detectedType === 'pdf' && (
            <div className="option">
              <label>Output Format</label>
              <div className="output-info">
                <span className="output-format-badge">PDF</span>
                <span className="output-hint">
                  Move to converter to create XTC
                </span>
              </div>
            </div>
          )}

          {mode === 'split' && (
            <>
              <div className="option">
                <label htmlFor="splitMethod">Split Method</label>
                <select
                  id="splitMethod"
                  value={splitMethod}
                  onChange={(e) => setSplitMethod(e.target.value as SplitMethod)}
                >
                  <option value="ranges">Page Ranges</option>
                  <option value="parts">Equal Parts</option>
                </select>
              </div>

              {splitMethod === 'ranges' ? (
                <div className="option">
                  <label htmlFor="rangesInput">Page Ranges</label>
                  <input
                    type="text"
                    id="rangesInput"
                    placeholder="e.g., 1-10, 11-20, 21-30"
                    value={rangesInput}
                    onChange={(e) => setRangesInput(e.target.value)}
                  />
                  <small className="help-text">
                    Separate ranges with commas
                  </small>
                </div>
              ) : (
                <div className="option">
                  <label htmlFor="partsCount">Number of Parts</label>
                  <input
                    type="number"
                    id="partsCount"
                    min={2}
                    max={totalPages || 100}
                    value={partsCount}
                    onChange={(e) => setPartsCount(Math.max(2, parseInt(e.target.value) || 2))}
                  />
                </div>
              )}

              {/* Output count preview */}
              {expectedOutputCount > 0 && (
                <div className="output-preview">
                  Will create <strong>{expectedOutputCount}</strong> {actualOutputFormat.toUpperCase()} file{expectedOutputCount !== 1 ? 's' : ''}
                </div>
              )}
            </>
          )}

          {/* Merge output preview */}
          {mode === 'merge' && files.length >= 2 && (
            <div className="output-preview">
              Will create <strong>1</strong> {actualOutputFormat.toUpperCase()} file
            </div>
          )}
        </aside>
      )}

      {/* Process Button */}
      {files.length > 0 && (
        <section className="action-section">
          <button
            className={`btn-convert${isProcessing ? ' loading' : ''}`}
            onClick={handleProcess}
            disabled={isProcessing || !canProcess}
          >
            <span>{mode === 'merge' ? 'Merge' : 'Split'}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
          {mode === 'merge' && files.length < 2 && (
            <p className="help-text">Add at least 2 files to merge</p>
          )}
        </section>
      )}

      {/* Progress */}
      {isProcessing && (
        <section className="progress-section">
          <div className="progress-header">
            <span className="progress-text">{progressText}</span>
            <span className="progress-percent">{Math.round(progress * 100)}%</span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          {previewUrl && (
            <div className="preview-container">
              <img src={previewUrl} alt="Preview" />
            </div>
          )}
        </section>
      )}

      {/* Results */}
      {results.length > 0 && !results.every(r => r.error) && (
        <section className="results-section">
          <div className="section-header">
            <h2>Complete</h2>
            <span className="badge">{results.filter(r => !r.error).length}</span>
            {results.length > 1 && (
              <button className="btn-select-all" onClick={handleSelectAll}>
                {results.every(r => r.selected) ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>
          <div className="results-grid">
            {results.map((result, idx) => (
              <div
                key={`${result.name}-${idx}`}
                className={`result-item${result.error ? ' error' : ''}${result.selected ? ' selected' : ''}`}
              >
                {!result.error && results.length > 1 && (
                  <label className="result-checkbox">
                    <input
                      type="checkbox"
                      checked={result.selected || false}
                      onChange={() => handleToggleSelect(idx)}
                    />
                    <span className="checkmark"></span>
                  </label>
                )}
                <div className="result-info">
                  <span className="name">{result.name}</span>
                  {result.error ? (
                    <div className="info">Error: {result.error}</div>
                  ) : (
                    <div className="info">
                      {result.pageCount} pages &middot; {formatSize(result.size)}
                    </div>
                  )}
                </div>
                {!result.error && (
                  <div className="result-actions">
                    {result.pageImages && (
                      <button
                        className="btn-preview"
                        onClick={() => handlePreview(result)}
                      >
                        Preview
                      </button>
                    )}
                    <button
                      className="btn-download"
                      onClick={() => handleDownload(result)}
                    >
                      Download
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="results-actions">
            {results.length > 1 && !results.some(r => r.error) && (
              <button
                className="btn-download-all"
                onClick={() => results.forEach(handleDownload)}
              >
                Download All ({results.length})
              </button>
            )}

            {canMoveToConverter && (
              <button
                className="btn-move-converter"
                onClick={handleMoveToConverter}
              >
                Convert {selectedResults.length > 1 ? `${selectedResults.length} files` : ''} to XTC
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
            )}
          </div>

          {canMoveToConverter && selectedResults.length > 0 && (
            <p className="converter-hint">
              {selectedResults.length === 1
                ? 'Selected file will be sent to the converter'
                : `${selectedResults.length} selected files will be sent to the converter`}
            </p>
          )}
        </section>
      )}

      {/* Error-only results */}
      {results.length > 0 && results.every(r => r.error) && (
        <section className="results-section">
          <div className="section-header">
            <h2>Error</h2>
          </div>
          <div className="results-grid">
            {results.map((result, idx) => (
              <div key={idx} className="result-item error">
                <div className="result-info">
                  <div className="info">{result.error}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Viewer */}
      <Viewer pages={viewerPages} onClose={() => setViewerPages([])} />
    </>
  )
}
