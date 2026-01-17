import { useState, useCallback } from 'react'
import { Dropzone } from './Dropzone'
import { FileList } from './FileList'
import { Options } from './Options'
import { Progress } from './Progress'
import { Results, downloadResult } from './Results'
import { Viewer } from './Viewer'
import { convertToXtc, type ConversionOptions, type ConversionResult } from '../lib/converter'
import { recordConversion } from '../lib/api'

interface ConverterPageProps {
  fileType: 'cbz' | 'pdf'
  notice?: string
}

export function ConverterPage({ fileType, notice }: ConverterPageProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [results, setResults] = useState<ConversionResult[]>([])
  const [isConverting, setIsConverting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('Processing...')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [viewerPages, setViewerPages] = useState<string[]>([])
  const [options, setOptions] = useState<ConversionOptions>({
    splitMode: 'overlap',
    dithering: 'floyd',
    contrast: 4,
    margin: 0,
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
    setResults([])
    setProgress(0)
    setProgressText('Processing...')
    setPreviewUrl(null)

    const newResults: ConversionResult[] = []

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i]
      setProgressText(file.name)
      setProgress(i / selectedFiles.length)

      try {
        const result = await convertToXtc(file, fileType, options, (pageProgress, preview) => {
          setProgress((i + pageProgress) / selectedFiles.length)
          if (preview) setPreviewUrl(preview)
        })
        newResults.push(result)

        if (result.pageCount && result.size) {
          recordConversion({
            pageCount: result.pageCount,
            fileSize: result.size,
          }).catch(() => {})
        }
      } catch (err) {
        console.error(`Error converting ${file.name}:`, err)
        newResults.push({
          name: file.name.replace(/\.(cbz|pdf)$/i, '.xtc'),
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    setProgress(1)
    setProgressText('Complete')
    setPreviewUrl(null)
    setIsConverting(false)
    setResults(newResults)
  }, [selectedFiles, fileType, options])

  const handlePreview = useCallback((result: ConversionResult) => {
    if (result.pageImages) {
      setViewerPages(result.pageImages)
    }
  }, [])

  const handleCloseViewer = useCallback(() => {
    setViewerPages([])
  }, [])

  return (
    <>
      {notice && (
        <div className="converter-notice">
          <p>{notice}</p>
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
        results={results}
        onDownload={downloadResult}
        onPreview={handlePreview}
      />

      <Viewer pages={viewerPages} onClose={handleCloseViewer} />
    </>
  )
}
