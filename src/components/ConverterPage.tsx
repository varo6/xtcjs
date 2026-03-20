import { useState, useCallback, useEffect, useRef } from 'react'
import { Dropzone } from './Dropzone'
import { FileList } from './FileList'
import { Options } from './Options'
import { Progress } from './Progress'
import { Results } from './Results'
import { Viewer } from './Viewer'
import JSZip from 'jszip'
import { convertToXtc } from '../lib/converter'
import type { ConversionOptions } from '../lib/conversion/types'
import { recordConversion } from '../lib/api'
import { consumePendingFiles } from '../lib/file-transfer'
import { useStoredResults, type StoredResult } from '../hooks/useStoredResults'
import { extractXtcPages } from '../lib/xtc-reader'
import { normalizeUserErrorMessage } from '../lib/errors'

interface ConverterPageProps {
  fileType: 'cbz' | 'pdf' | 'image' | 'video'
  notice?: string
}

const MAX_FALLBACK_PREVIEW_PAGES = 200
const PROGRESS_UPDATE_INTERVAL_MS = 120

function formatZipTimestamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

function normalizeZipEntryName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'conversion.xtc'
  const baseName = trimmed.split(/[\\/]/).pop()
  return baseName && baseName.length > 0 ? baseName : 'conversion.xtc'
}

function getUniqueZipEntryName(fileName: string, usedNames: Set<string>): string {
  const normalized = fileName.toLowerCase()
  if (!usedNames.has(normalized)) {
    usedNames.add(normalized)
    return fileName
  }

  const dotIndex = fileName.lastIndexOf('.')
  const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  const ext = dotIndex > 0 ? fileName.slice(dotIndex) : ''

  let suffix = 2
  let candidate = `${base} (${suffix})${ext}`
  while (usedNames.has(candidate.toLowerCase())) {
    suffix++
    candidate = `${base} (${suffix})${ext}`
  }

  usedNames.add(candidate.toLowerCase())
  return candidate
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
        if (fileType === 'image') {
          return /\.(jpg|jpeg|png|webp|bmp|gif)$/i.test(name)
        }
        if (fileType === 'video') {
          return /\.(mp4|webm|mkv|avi|mov)$/i.test(name)
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
  const [isDownloadAllLoading, setIsDownloadAllLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [viewerPages, setViewerPages] = useState<string[]>([])
  const progressPreviewRef = useRef<string | null>(null)
  const pendingProgressRef = useRef<number | null>(null)
  const pendingPreviewRef = useRef<string | undefined>(undefined)
  const progressTimerRef = useRef<number | null>(null)
  const lastProgressFlushRef = useRef(0)
  const previewCacheRef = useRef<Map<string, string[]>>(new Map())
  const [options, setOptions] = useState<ConversionOptions>({
    device: 'X4',
    splitMode: (fileType === 'image' || fileType === 'video') ? 'nosplit' : 'overlap',
    pageOverview: 'none',
    dithering: fileType === 'pdf' ? 'atkinson' : 'floyd',
    is2bit: false,
    contrast: fileType === 'pdf' ? 8 : 4,
    horizontalMargin: 0,
    verticalMargin: 0,
    orientation: (fileType === 'image' || fileType === 'video') ? 'portrait' : 'landscape',
    landscapeFlipClockwise: false,
    showProgressPreview: true,
    imageMode: fileType === 'image' ? 'cover' : 'letterbox',
    videoFps: 1.0,
  })

  const handleFiles = useCallback((files: File[]) => {
    setSelectedFiles(prev => [...prev, ...files])
  }, [])

  const handleRemove = useCallback((index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }, [])

  const flushProgressUi = useCallback((force = false) => {
    const now = performance.now()
    if (!force && now - lastProgressFlushRef.current < PROGRESS_UPDATE_INTERVAL_MS) {
      return
    }

    if (pendingProgressRef.current !== null) {
      setProgress(pendingProgressRef.current)
      pendingProgressRef.current = null
    }

    if (pendingPreviewRef.current !== undefined) {
      const nextPreview = pendingPreviewRef.current
      pendingPreviewRef.current = undefined

      if (progressPreviewRef.current && progressPreviewRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(progressPreviewRef.current)
      }
      progressPreviewRef.current = nextPreview ?? null
      setPreviewUrl(nextPreview ?? null)
    }

    lastProgressFlushRef.current = now
  }, [])

  const scheduleProgressUiFlush = useCallback((force = false) => {
    if (force) {
      if (progressTimerRef.current !== null) {
        clearTimeout(progressTimerRef.current)
        progressTimerRef.current = null
      }
      flushProgressUi(true)
      return
    }

    if (progressTimerRef.current !== null) {
      return
    }

    const elapsed = performance.now() - lastProgressFlushRef.current
    const delay = Math.max(0, PROGRESS_UPDATE_INTERVAL_MS - elapsed)
    progressTimerRef.current = window.setTimeout(() => {
      progressTimerRef.current = null
      flushProgressUi(true)
    }, delay)
  }, [flushProgressUi])

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
    if (progressTimerRef.current !== null) {
      clearTimeout(progressTimerRef.current)
      progressTimerRef.current = null
    }
    pendingProgressRef.current = null
    pendingPreviewRef.current = undefined
    lastProgressFlushRef.current = performance.now()
    setPreviewUrl(null)

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i]
      setProgressText(file.name)
      setProgress(i / selectedFiles.length)

      try {
        // Determine actual file type (cbz vs cbr vs image vs video)
        let actualFileType: 'cbz' | 'cbr' | 'pdf' | 'image' | 'video' = fileType
        if (file.name.toLowerCase().endsWith('.cbr')) {
          actualFileType = 'cbr'
        } else if (fileType === 'image') {
          actualFileType = 'image'
        } else if (fileType === 'video') {
          actualFileType = 'video'
        }
        const result = await convertToXtc(file, actualFileType, options, (pageProgress, preview) => {
          pendingProgressRef.current = (i + pageProgress) / selectedFiles.length
          if (preview) {
            pendingPreviewRef.current = preview
          }
          scheduleProgressUiFlush(pageProgress >= 0.999)
        })

        // Store result immediately - progressive display
        await addResult(result)

        recordConversion(fileType === 'image' || fileType === 'video' ? 'cbz' : fileType).catch(() => {})
      } catch (err) {
        console.error(`Error converting ${file.name}:`, err)
        const fallbackExtension = fileType === 'image' && options.is2bit ? '.xtch' : '.xtc'
        // Store error result
        await addResult({
          name: file.name.replace(/\.[^/.]+$/i, fallbackExtension),
          error: normalizeUserErrorMessage(err instanceof Error ? err.message : 'Unknown error'),
        })
      }

      pendingProgressRef.current = (i + 1) / selectedFiles.length
      scheduleProgressUiFlush(true)
    }

    if (progressTimerRef.current !== null) {
      clearTimeout(progressTimerRef.current)
      progressTimerRef.current = null
    }
    pendingProgressRef.current = null
    pendingPreviewRef.current = undefined
    setProgress(1)
    setProgressText('Complete')
    if (progressPreviewRef.current && progressPreviewRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(progressPreviewRef.current)
      progressPreviewRef.current = null
    }
    setPreviewUrl(null)
    setIsConverting(false)
  }, [selectedFiles, fileType, options, addResult, clearSession, scheduleProgressUiFlush])

  const handlePreview = useCallback(async (result: StoredResult) => {
    const cached = previewCacheRef.current.get(result.id)
    if (cached && cached.length > 0) {
      setViewerPages(cached)
      return
    }

    const images = await getPreviewImages(result)
    if (images.length > 0) {
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

    const decodeLimit = result.pageCount > MAX_FALLBACK_PREVIEW_PAGES
      ? MAX_FALLBACK_PREVIEW_PAGES
      : undefined
    const canvases = await extractXtcPages(data, decodeLimit)
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

  const handleDownloadAll = useCallback(async () => {
    if (isDownloadAllLoading) {
      return
    }

    const successfulResults = [...recoveredResults, ...results].filter(result => !result.error)
    if (successfulResults.length === 0) {
      return
    }

    setIsDownloadAllLoading(true)

    try {
      const zip = new JSZip()
      const usedNames = new Set<string>()
      let addedCount = 0

      for (const result of successfulResults) {
        const data = await getResultData(result)
        if (!data || data.byteLength === 0) {
          console.warn(`Skipping ${result.name}: no data found`)
          continue
        }

        const entryName = getUniqueZipEntryName(normalizeZipEntryName(result.name), usedNames)
        zip.file(entryName, data)
        addedCount++
      }

      if (addedCount === 0) {
        console.warn('No valid files found for ZIP download')
        return
      }

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
      })
      const archiveName = `xtcjs-conversions-${formatZipTimestamp(new Date())}.zip`
      const url = URL.createObjectURL(zipBlob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = archiveName
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Download all failed:', err)
    } finally {
      setIsDownloadAllLoading(false)
    }
  }, [recoveredResults, results, getResultData, isDownloadAllLoading])

  const handleClearResults = useCallback(async () => {
    await clearSession()
    previewCacheRef.current.clear()
  }, [clearSession])

  useEffect(() => {
    return () => {
      if (progressTimerRef.current !== null) {
        clearTimeout(progressTimerRef.current)
      }
      if (progressPreviewRef.current && progressPreviewRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(progressPreviewRef.current)
      }
    }
  }, [])

  // Combine current and recovered results for display
  const allResults = [...recoveredResults, ...results]
  const downloadableCount = allResults.filter(result => !result.error).length

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

      <Options options={options} onChange={setOptions} fileType={fileType} />

      <Progress
        visible={isConverting}
        progress={progress}
        text={progressText}
        previewUrl={previewUrl}
      />

      <Results
        results={allResults}
        onDownload={handleDownload}
        onDownloadAll={downloadableCount > 0 ? handleDownloadAll : undefined}
        downloadAllCount={downloadableCount}
        isDownloadAllLoading={isDownloadAllLoading}
        onPreview={handlePreview}
        onClear={results.length > 0 ? handleClearResults : undefined}
      />

      <Viewer pages={viewerPages} onClose={handleCloseViewer} />
    </>
  )
}
