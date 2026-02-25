import { useState, useCallback, useEffect, useRef } from 'react'
import { Dropzone } from './Dropzone'
import { FileList } from './FileList'
import { Options } from './Options'
import { Progress } from './Progress'
import { Results } from './Results'
import { Viewer } from './Viewer'
import { convertToXtc } from '../lib/converter'
import type { ConversionOptions } from '../lib/conversion/types'
import { recordConversion } from '../lib/api'
import { consumePendingFiles } from '../lib/file-transfer'
import { useStoredResults, type StoredResult } from '../hooks/useStoredResults'
import { extractXtcPages } from '../lib/xtc-reader'

interface ConverterPageProps {
  fileType: 'cbz' | 'pdf'
  notice?: string
}

export function ConverterPage({ fileType, notice }: ConverterPageProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [transferNotice, setTransferNotice] = useState<string | null>(null)

  // Use IndexedDB-backed storage for results
  const {
    results,
    recoveredResults,
    recoveredCount,
    addResult,
    clearSession,
    clearAll,
    dismissRecovered,
    downloadResult,
    getPreviewImages,
    getResultData,
  } = useStoredResults()

  // Check for transferred files on mount
  useEffect(() => {
    const pending = consumePendingFiles()
    if (pending.length > 0) {
      // Filter files matching this converter's type
      const matchingFiles = pending.filter(f => {
        const name = f.name.toLowerCase()
        if (fileType === 'pdf') {
          return name.endsWith('.pdf')
        }
        // Accept both .cbz and .cbr for comic book type
        return name.endsWith('.cbz') || name.endsWith('.cbr')
      })
      if (matchingFiles.length > 0) {
        setSelectedFiles(matchingFiles)
        setTransferNotice(
          `${matchingFiles.length} file${matchingFiles.length > 1 ? 's' : ''} received from merge/split`
        )
        // Clear notice after 5 seconds
        setTimeout(() => setTransferNotice(null), 5000)
      }
    }
  }, [fileType])

  const [isConverting, setIsConverting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('Processing...')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [viewerPages, setViewerPages] = useState<string[]>([])
  const progressPreviewRef = useRef<string | null>(null)
  const previewCacheRef = useRef<Map<string, string[]>>(new Map())
  const [options, setOptions] = useState<ConversionOptions>({
    splitMode: 'overlap',
    dithering: fileType === 'pdf' ? 'atkinson' : 'floyd',
    contrast: fileType === 'pdf' ? 8 : 4,
    horizontalMargin: 0,
    verticalMargin: 0,
    orientation: 'landscape',
    landscapeFlipClockwise: false,
  })

  const handleFiles = useCallback((files: File[]) => {
    setSelectedFiles(prev => [...prev, ...files])
  }, [])

  const handleRemove = useCallback((index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleConvert = useCallback(async () => {
    if (selectedFiles.length === 0) return

    setIsConverting(true)
    await clearSession() // Clear previous session results
    setProgress(0)
    setProgressText('Processing...')
    if (progressPreviewRef.current && progressPreviewRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(progressPreviewRef.current)
      progressPreviewRef.current = null
    }
    setPreviewUrl(null)

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i]
      setProgressText(file.name)
      setProgress(i / selectedFiles.length)

      try {
        // Determine actual file type (cbz vs cbr)
        const actualFileType = file.name.toLowerCase().endsWith('.cbr') ? 'cbr' : fileType
        const result = await convertToXtc(file, actualFileType, options, (pageProgress, preview) => {
          setProgress((i + pageProgress) / selectedFiles.length)
          if (!preview) return

          if (progressPreviewRef.current && progressPreviewRef.current.startsWith('blob:')) {
            URL.revokeObjectURL(progressPreviewRef.current)
          }
          progressPreviewRef.current = preview
          setPreviewUrl(preview)
        })

        // Store result immediately - progressive display
        await addResult(result)

        recordConversion(fileType).catch(() => {})
      } catch (err) {
        console.error(`Error converting ${file.name}:`, err)
        // Store error result
        await addResult({
          name: file.name.replace(/\.(cbz|cbr|pdf)$/i, '.xtc'),
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    setProgress(1)
    setProgressText('Complete')
    if (progressPreviewRef.current && progressPreviewRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(progressPreviewRef.current)
      progressPreviewRef.current = null
    }
    setPreviewUrl(null)
    setIsConverting(false)
  }, [selectedFiles, fileType, options, addResult, clearSession])

  const handlePreview = useCallback(async (result: StoredResult) => {
    const cached = previewCacheRef.current.get(result.id)
    if (cached && cached.length > 0) {
      setViewerPages(cached)
      return
    }

    const images = await getPreviewImages(result)
    if (images.length > 0 && images.length === result.pageCount) {
      previewCacheRef.current.set(result.id, images)
      setViewerPages(images)
      return
    }

    const data = await getResultData(result)
    if (!data || data.byteLength === 0) {
      if (images.length > 0) {
        previewCacheRef.current.set(result.id, images)
        setViewerPages(images)
      }
      return
    }

    const canvases = await extractXtcPages(data)
    const decodedImages = canvases.map((canvas) => canvas.toDataURL('image/png'))
    previewCacheRef.current.set(result.id, decodedImages)
    setViewerPages(decodedImages)
  }, [getPreviewImages, getResultData])

  const handleCloseViewer = useCallback(() => {
    setViewerPages([])
  }, [])

  const handleDownload = useCallback(async (result: StoredResult) => {
    try {
      await downloadResult(result)
    } catch (err) {
      console.error('Download failed:', err)
    }
  }, [downloadResult])

  const handleClearResults = useCallback(async () => {
    await clearSession()
    previewCacheRef.current.clear()
  }, [clearSession])

  useEffect(() => {
    return () => {
      if (progressPreviewRef.current && progressPreviewRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(progressPreviewRef.current)
      }
    }
  }, [])

  // Combine current and recovered results for display
  const allResults = [...recoveredResults, ...results]

  return (
    <>
      {notice && (
        <div className="converter-notice">
          <p>{notice}</p>
        </div>
      )}

      {transferNotice && (
        <div className="transfer-notice">
          <p>{transferNotice}</p>
        </div>
      )}

      {recoveredCount > 0 && (
        <div className="recovered-notice">
          <p>
            Recovered {recoveredCount} file{recoveredCount > 1 ? 's' : ''} from previous session
          </p>
          <div className="recovered-actions">
            <button onClick={dismissRecovered} className="btn-dismiss">
              Dismiss
            </button>
            <button onClick={clearAll} className="btn-clear-all">
              Clear All
            </button>
          </div>
        </div>
      )}

      <Dropzone onFiles={handleFiles} fileType={fileType} />

      <FileList
        files={selectedFiles}
        onRemove={handleRemove}
        onConvert={handleConvert}
        isConverting={isConverting}
      />

      <Options options={options} onChange={setOptions} />

      <Progress
        visible={isConverting}
        progress={progress}
        text={progressText}
        previewUrl={previewUrl}
      />

      <Results
        results={allResults}
        onDownload={handleDownload}
        onPreview={handlePreview}
        onClear={results.length > 0 ? handleClearResults : undefined}
      />

      <Viewer pages={viewerPages} onClose={handleCloseViewer} />
    </>
  )
}
