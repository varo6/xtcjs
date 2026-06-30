import { useMemo, useReducer } from 'react'
import { Dropzone } from './Dropzone'
import { formatSize } from '../utils/format'
import { decodeXtcPageToCanvas } from '../lib/xtc-reader'
import { importPagesForBook, PAGE_IMPORT_ACCEPT } from '../lib/page-import'
import {
  createEditedXtcBlob,
  inspectReplaceableXtc,
  readXtcPage,
  type ImportedXtcPage,
  type ReplaceableXtcBook,
  type XtcPageEdit,
  type XtcPageEditMode,
} from '../lib/page-replacement'

interface QueuedPageEdit {
  mode: XtcPageEditMode
  pageNumber: number
  file: File
  pages: ImportedXtcPage[]
  originalPreview: string | null
  importedPreview: string
}

type EditorStatus = 'idle' | 'inspecting' | 'ready' | 'importing' | 'saving'

interface EditorState {
  source: File | null
  book: ReplaceableXtcBook | null
  status: EditorStatus
  error: string | null
  mode: XtcPageEditMode
  pageInput: string
  importFile: File | null
  fileInputVersion: number
  importProgress: number
  edits: QueuedPageEdit[]
}

type EditorAction =
  | { type: 'inspect-start'; source: File }
  | { type: 'inspect-success'; book: ReplaceableXtcBook }
  | { type: 'inspect-failure'; error: string }
  | { type: 'set-mode'; mode: XtcPageEditMode }
  | { type: 'set-page'; value: string }
  | { type: 'set-file'; file: File | null }
  | { type: 'import-start' }
  | { type: 'import-progress'; progress: number }
  | { type: 'import-success'; edit: QueuedPageEdit }
  | { type: 'ready-error'; error: string }
  | { type: 'remove'; pageNumber: number }
  | { type: 'save-start' }
  | { type: 'save-complete' }
  | { type: 'reset' }

const initialState: EditorState = {
  source: null,
  book: null,
  status: 'idle',
  error: null,
  mode: 'replace',
  pageInput: '',
  importFile: null,
  fileInputVersion: 0,
  importProgress: 0,
  edits: [],
}

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'inspect-start':
      return { ...initialState, source: action.source, status: 'inspecting' }
    case 'inspect-success':
      return { ...state, book: action.book, status: 'ready', error: null }
    case 'inspect-failure':
      return { ...initialState, error: action.error }
    case 'set-mode':
      return { ...state, mode: action.mode, error: null }
    case 'set-page':
      return { ...state, pageInput: action.value, error: null }
    case 'set-file':
      return { ...state, importFile: action.file, error: null }
    case 'import-start':
      return { ...state, status: 'importing', importProgress: 0, error: null }
    case 'import-progress':
      return { ...state, importProgress: Math.max(0, Math.min(1, action.progress)) }
    case 'import-success':
      return {
        ...state,
        status: 'ready',
        error: null,
        pageInput: '',
        importFile: null,
        importProgress: 0,
        fileInputVersion: state.fileInputVersion + 1,
        edits: [...state.edits, action.edit].sort((left, right) => left.pageNumber - right.pageNumber),
      }
    case 'ready-error':
      return { ...state, status: 'ready', importProgress: 0, error: action.error }
    case 'remove':
      return {
        ...state,
        error: null,
        edits: state.edits.filter((edit) => edit.pageNumber !== action.pageNumber),
      }
    case 'save-start':
      return { ...state, status: 'saving', error: null }
    case 'save-complete':
      return { ...state, status: 'ready' }
    case 'reset':
      return initialState
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The page edit could not be completed.'
}

function getOptionalPagePreview(buffer: ArrayBuffer | null): string | null {
  if (!buffer) return null
  try {
    return decodeXtcPageToCanvas(buffer).toDataURL('image/png')
  } catch {
    return null
  }
}

function downloadEditedBook(source: File, book: ReplaceableXtcBook, output: Blob): void {
  const extension = book.is2bit ? 'xtch' : 'xtc'
  const baseName = source.name.replace(/\.(xtc|xtch)$/i, '')
  const url = URL.createObjectURL(output)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${baseName}_pages-edited.${extension}`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

interface BookSummaryProps {
  source: File
  book: ReplaceableXtcBook
  disabled: boolean
  onClose: () => void
}

function BookSummary({ source, book, disabled, onClose }: BookSummaryProps) {
  return (
    <section className="page-replace-card page-replace-summary">
      <div>
        <span className="page-replace-eyebrow">Source book</span>
        <h3>{source.name}</h3>
      </div>
      <dl className="page-replace-facts">
        <div><dt>Format</dt><dd>{book.is2bit ? 'XTCH · 2-bit' : 'XTC · 1-bit'}</dd></div>
        <div><dt>Pages</dt><dd>{book.pageCount.toLocaleString()}</dd></div>
        <div><dt>Size</dt><dd>{formatSize(source.size)}</dd></div>
        <div><dt>Imports become</dt><dd>.{book.pageMagic.toLowerCase()}</dd></div>
      </dl>
      <p className="page-replace-preservation">
        {book.hasMetadata
          ? 'Metadata is retained; recognized TOC page references are adjusted when the page count changes.'
          : 'No metadata block detected.'}
      </p>
      <button type="button" className="btn-clear-results" onClick={onClose} disabled={disabled}>
        Close book
      </button>
    </section>
  )
}

interface PageEditFormProps {
  book: ReplaceableXtcBook
  mode: XtcPageEditMode
  pageInput: string
  importFile: File | null
  fileInputVersion: number
  disabled: boolean
  importing: boolean
  importProgress: number
  onModeChange: (mode: XtcPageEditMode) => void
  onPageChange: (value: string) => void
  onFileChange: (file: File | null) => void
  onSubmit: () => void
}

function PageEditForm({
  book,
  mode,
  pageInput,
  importFile,
  fileInputVersion,
  disabled,
  importing,
  importProgress,
  onModeChange,
  onPageChange,
  onFileChange,
  onSubmit,
}: PageEditFormProps) {
  const maxPage = mode === 'add' ? book.pageCount + 1 : book.pageCount

  return (
    <section className="page-replace-card">
      <div className="page-replace-card-heading">
        <div>
          <span className="page-replace-eyebrow">New page edit</span>
          <h3>{mode === 'add' ? 'Insert imported pages at a position' : 'Replace one page with imported pages'}</h3>
        </div>
        <span className="badge">1-based</span>
      </div>

      <fieldset className="page-edit-mode" disabled={disabled}>
        <legend>Operation</legend>
        <button
          type="button"
          className={mode === 'replace' ? 'active' : ''}
          aria-pressed={mode === 'replace'}
          onClick={() => onModeChange('replace')}
        >
          Replace
        </button>
        <button
          type="button"
          className={mode === 'add' ? 'active' : ''}
          aria-pressed={mode === 'add'}
          onClick={() => onModeChange('add')}
        >
          Add
        </button>
      </fieldset>

      <div className="page-replace-form">
        <label>
          <span>{mode === 'add' ? 'Insert before page' : 'Page to replace'}</span>
          <input
            type="number"
            min={1}
            max={maxPage}
            inputMode="numeric"
            aria-describedby="page-edit-position-help"
            value={pageInput}
            placeholder={`1–${maxPage}`}
            disabled={disabled}
            onChange={(event) => onPageChange(event.target.value)}
          />
        </label>

        <label>
          <span>Pages to import</span>
          <input
            key={fileInputVersion}
            type="file"
            accept={PAGE_IMPORT_ACCEPT}
            aria-describedby="page-edit-format-help"
            disabled={disabled}
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      <p className="page-edit-help" id="page-edit-position-help">
        {mode === 'add'
          ? `Imported pages are inserted before this position. Use ${book.pageCount + 1} to append.`
          : 'The selected source may contain one page or many; all imported pages replace this single page.'}
        {' '}When several edits are queued, every position refers to the original source book.
      </p>
      <p className="page-edit-help" id="page-edit-format-help">
        Accepts XTG/XTH, XTC/XTCH, CBZ/CBR, PDF, PNG, JPG, WEBP, BMP, and GIF.
        Images and archives are converted automatically to match the source book.
      </p>

      {importFile && (
        <p className="page-replace-selected-file">
          Selected: <strong>{importFile.name}</strong> · {formatSize(importFile.size)}
        </p>
      )}

      {importing && (
        <output className="page-edit-progress" aria-live="polite">
          <div><span>Preparing pages…</span><strong>{Math.round(importProgress * 100)}%</strong></div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${importProgress * 100}%` }} /></div>
        </output>
      )}

      <button
        type="button"
        className="btn-preview page-replace-queue-button"
        disabled={disabled || !pageInput || !importFile}
        onClick={onSubmit}
      >
        {importing ? 'Preparing pages…' : 'Prepare & queue'}
      </button>
    </section>
  )
}

interface PageEditQueueProps {
  edits: QueuedPageEdit[]
  disabled: boolean
  onRemove: (pageNumber: number) => void
}

function PageEditQueue({ edits, disabled, onRemove }: PageEditQueueProps) {
  if (edits.length === 0) {
    return (
      <section className="page-replace-empty">
        <p>No edits queued yet. Imported files are converted and validated before appearing here.</p>
      </section>
    )
  }

  return (
    <section className="page-replace-queue" aria-label="Queued page edits">
      <div className="page-replace-queue-heading">
        <h3>Queued edits</h3>
        <span className="badge">{edits.length}</span>
      </div>

      {edits.map((edit) => (
        <article className="page-replace-item" key={edit.pageNumber}>
          <header>
            <div>
              <span className="page-replace-eyebrow">
                {edit.mode === 'add' ? `Add at page ${edit.pageNumber}` : `Replace page ${edit.pageNumber}`}
              </span>
              <h4>{edit.file.name}</h4>
              <p>{edit.pages.length} imported page{edit.pages.length === 1 ? '' : 's'}</p>
            </div>
            <button
              type="button"
              className="btn-clear-results"
              disabled={disabled}
              onClick={() => onRemove(edit.pageNumber)}
              aria-label={`Remove ${edit.mode} edit at page ${edit.pageNumber}`}
            >
              Remove
            </button>
          </header>

          <div className={`page-replace-previews${edit.originalPreview ? '' : ' single'}`}>
            {edit.originalPreview && (
              <figure>
                <img src={edit.originalPreview} alt={`Current page ${edit.pageNumber}`} />
                <figcaption>{edit.mode === 'add' ? 'Insert before' : 'Current page'}</figcaption>
              </figure>
            )}
            <figure>
              <img src={edit.importedPreview} alt={`First imported page for position ${edit.pageNumber}`} />
              <figcaption>First imported page</figcaption>
            </figure>
          </div>
        </article>
      ))}
    </section>
  )
}

export function ReplacePagesPage() {
  const [state, dispatch] = useReducer(editorReducer, initialState)
  const isBusy = state.status === 'inspecting' || state.status === 'importing' || state.status === 'saving'
  const outputPageCount = useMemo(() => {
    if (!state.book) return 0
    return state.edits.reduce(
      (total, edit) => total + edit.pages.length - (edit.mode === 'replace' ? 1 : 0),
      state.book.pageCount
    )
  }, [state.book, state.edits])

  const handleBook = async (files: File[]) => {
    const source = files[0]
    if (!source) return

    dispatch({ type: 'inspect-start', source })
    try {
      const book = await inspectReplaceableXtc(source)
      dispatch({ type: 'inspect-success', book })
    } catch (error) {
      dispatch({ type: 'inspect-failure', error: getErrorMessage(error) })
    }
  }

  const handleQueue = async () => {
    if (!state.source || !state.book || !state.importFile) return

    const pageNumber = Number(state.pageInput)
    const maxPage = state.mode === 'add' ? state.book.pageCount + 1 : state.book.pageCount
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > maxPage) {
      dispatch({ type: 'ready-error', error: `Page number must be between 1 and ${maxPage}.` })
      return
    }
    if (state.edits.some((edit) => edit.pageNumber === pageNumber)) {
      dispatch({
        type: 'ready-error',
        error: `Page ${pageNumber} already has a queued edit. Remove it before choosing another operation there.`,
      })
      return
    }

    dispatch({ type: 'import-start' })
    try {
      const originalPromise = pageNumber <= state.book.pageCount
        ? readXtcPage(state.source, state.book, pageNumber)
        : Promise.resolve(null)
      const [originalBuffer, importedPages] = await Promise.all([
        originalPromise,
        importPagesForBook(state.importFile, state.book, (progress) => {
          dispatch({ type: 'import-progress', progress })
        }),
      ])

      if (importedPages.length === 0) {
        throw new Error('The selected file did not produce any pages.')
      }
      const importedBuffer = await importedPages[0].data.arrayBuffer()
      dispatch({
        type: 'import-success',
        edit: {
          mode: state.mode,
          pageNumber,
          file: state.importFile,
          pages: importedPages,
          originalPreview: getOptionalPagePreview(originalBuffer),
          importedPreview: decodeXtcPageToCanvas(importedBuffer).toDataURL('image/png'),
        },
      })
    } catch (error) {
      dispatch({ type: 'ready-error', error: getErrorMessage(error) })
    }
  }

  const handleSave = async () => {
    if (!state.source || !state.book || state.edits.length === 0) return

    dispatch({ type: 'save-start' })
    try {
      const edits: XtcPageEdit[] = state.edits.map(({ mode, pageNumber, pages }) => ({
        mode,
        pageNumber,
        pages,
      }))
      const output = await createEditedXtcBlob(state.source, state.book, edits)
      downloadEditedBook(state.source, state.book, output)
      dispatch({ type: 'save-complete' })
    } catch (error) {
      dispatch({ type: 'ready-error', error: getErrorMessage(error) })
    }
  }

  return (
    <div className="content-section page-replace-page">
      <div className="converter-notice page-edit-notice">
        <p>Add or replace pages in an existing XTC/XTCH book. Imported files are converted automatically.</p>
      </div>

      {!state.source && state.status !== 'inspecting' && (
        <Dropzone onFiles={handleBook} fileType="xtc" multiple={false} />
      )}

      {state.status === 'inspecting' && (
        <p className="metadata-status" role="status">Reading the book header and page index…</p>
      )}

      {state.error && (
        <div className="page-replace-error" role="alert">{state.error}</div>
      )}

      {state.source && state.book && (
        <div className="page-replace-editor">
          <BookSummary
            source={state.source}
            book={state.book}
            disabled={isBusy}
            onClose={() => dispatch({ type: 'reset' })}
          />
          <PageEditForm
            book={state.book}
            mode={state.mode}
            pageInput={state.pageInput}
            importFile={state.importFile}
            fileInputVersion={state.fileInputVersion}
            disabled={isBusy}
            importing={state.status === 'importing'}
            importProgress={state.importProgress}
            onModeChange={(mode) => dispatch({ type: 'set-mode', mode })}
            onPageChange={(value) => dispatch({ type: 'set-page', value })}
            onFileChange={(file) => dispatch({ type: 'set-file', file })}
            onSubmit={handleQueue}
          />
          <PageEditQueue
            edits={state.edits}
            disabled={isBusy}
            onRemove={(pageNumber) => dispatch({ type: 'remove', pageNumber })}
          />

          <section className="page-replace-download">
            <button
              type="button"
              className={`btn-convert${state.status === 'saving' ? ' loading' : ''}`}
              disabled={isBusy || state.edits.length === 0}
              onClick={handleSave}
            >
              <span>
                Download edited book
                {state.edits.length > 0 ? ` · ${outputPageCount.toLocaleString()} pages` : ''}
              </span>
            </button>
            <p>Creates a new file. Your uploaded book is never modified or uploaded.</p>
          </section>
        </div>
      )}
    </div>
  )
}
