import { useReducer } from 'react'
import { Dropzone } from './Dropzone'
import { formatSize } from '../utils/format'
import { decodeXtcPageToCanvas } from '../lib/xtc-reader'
import {
  createReplacedXtcBlob,
  inspectReplaceableXtc,
  readXtcPage,
  validateXtcPageBuffer,
  validateXtcPageReplacement,
  type ReplaceableXtcBook,
  type XtcPageReplacement,
} from '../lib/page-replacement'

interface QueuedReplacement {
  pageNumber: number
  file: File
  originalPreview: string
  replacementPreview: string
}

type EditorStatus = 'idle' | 'inspecting' | 'ready' | 'queueing' | 'saving'

interface EditorState {
  source: File | null
  book: ReplaceableXtcBook | null
  status: EditorStatus
  error: string | null
  pageInput: string
  replacementFile: File | null
  fileInputVersion: number
  replacements: QueuedReplacement[]
}

type EditorAction =
  | { type: 'inspect-start'; source: File }
  | { type: 'inspect-success'; book: ReplaceableXtcBook }
  | { type: 'inspect-failure'; error: string }
  | { type: 'set-page'; value: string }
  | { type: 'set-file'; file: File | null }
  | { type: 'queue-start' }
  | { type: 'queue-success'; replacement: QueuedReplacement }
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
  pageInput: '',
  replacementFile: null,
  fileInputVersion: 0,
  replacements: [],
}

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'inspect-start':
      return { ...initialState, source: action.source, status: 'inspecting' }
    case 'inspect-success':
      return { ...state, book: action.book, status: 'ready', error: null }
    case 'inspect-failure':
      return { ...initialState, error: action.error }
    case 'set-page':
      return { ...state, pageInput: action.value, error: null }
    case 'set-file':
      return { ...state, replacementFile: action.file, error: null }
    case 'queue-start':
      return { ...state, status: 'queueing', error: null }
    case 'queue-success':
      return {
        ...state,
        status: 'ready',
        error: null,
        pageInput: '',
        replacementFile: null,
        fileInputVersion: state.fileInputVersion + 1,
        replacements: [...state.replacements, action.replacement]
          .sort((left, right) => left.pageNumber - right.pageNumber),
      }
    case 'ready-error':
      return { ...state, status: 'ready', error: action.error }
    case 'remove':
      return {
        ...state,
        error: null,
        replacements: state.replacements.filter((item) => item.pageNumber !== action.pageNumber),
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
  return error instanceof Error ? error.message : 'The page replacement could not be completed.'
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
        <div><dt>Raw pages</dt><dd>.{book.pageMagic.toLowerCase()}</dd></div>
      </dl>
      <p className="page-replace-preservation">
        {book.hasMetadata ? 'Metadata detected and preserved byte-for-byte.' : 'No metadata block detected.'}
      </p>
      <button type="button" className="btn-clear-results" onClick={onClose} disabled={disabled}>
        Close book
      </button>
    </section>
  )
}

interface ReplacementFormProps {
  book: ReplaceableXtcBook
  pageInput: string
  replacementFile: File | null
  fileInputVersion: number
  disabled: boolean
  checking: boolean
  onPageChange: (value: string) => void
  onFileChange: (file: File | null) => void
  onSubmit: () => void
}

function ReplacementForm({
  book,
  pageInput,
  replacementFile,
  fileInputVersion,
  disabled,
  checking,
  onPageChange,
  onFileChange,
  onSubmit,
}: ReplacementFormProps) {
  const extension = book.pageMagic.toLowerCase()

  return (
    <section className="page-replace-card">
      <div className="page-replace-card-heading">
        <div>
          <span className="page-replace-eyebrow">New replacement</span>
          <h3>Select the target page and its .{extension} file</h3>
        </div>
        <span className="badge">1-based</span>
      </div>

      <div className="page-replace-form">
        <label>
          <span>Page number</span>
          <input
            type="number"
            min={1}
            max={book.pageCount}
            inputMode="numeric"
            value={pageInput}
            placeholder={`1–${book.pageCount}`}
            disabled={disabled}
            onChange={(event) => onPageChange(event.target.value)}
          />
        </label>

        <label>
          <span>Replacement .{extension}</span>
          <input
            key={fileInputVersion}
            type="file"
            accept={`.${extension},.${extension.toUpperCase()}`}
            disabled={disabled}
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      {replacementFile && (
        <p className="page-replace-selected-file">
          Selected: <strong>{replacementFile.name}</strong> · {formatSize(replacementFile.size)}
        </p>
      )}

      <button
        type="button"
        className="btn-preview page-replace-queue-button"
        disabled={disabled || !pageInput || !replacementFile}
        onClick={onSubmit}
      >
        {checking ? 'Checking page…' : 'Validate & queue'}
      </button>
    </section>
  )
}

interface ReplacementQueueProps {
  replacements: QueuedReplacement[]
  disabled: boolean
  onRemove: (pageNumber: number) => void
}

function ReplacementQueue({ replacements, disabled, onRemove }: ReplacementQueueProps) {
  if (replacements.length === 0) {
    return (
      <section className="page-replace-empty">
        <p>No pages queued yet. Each replacement is validated before it appears here.</p>
      </section>
    )
  }

  return (
    <section className="page-replace-queue" aria-label="Queued page replacements">
      <div className="page-replace-queue-heading">
        <h3>Queued replacements</h3>
        <span className="badge">{replacements.length}</span>
      </div>

      {replacements.map((replacement) => (
        <article className="page-replace-item" key={replacement.pageNumber}>
          <header>
            <div>
              <span className="page-replace-eyebrow">Page {replacement.pageNumber}</span>
              <h4>{replacement.file.name}</h4>
            </div>
            <button
              type="button"
              className="btn-clear-results"
              disabled={disabled}
              onClick={() => onRemove(replacement.pageNumber)}
              aria-label={`Remove replacement for page ${replacement.pageNumber}`}
            >
              Remove
            </button>
          </header>

          <div className="page-replace-previews">
            <figure>
              <img src={replacement.originalPreview} alt={`Original page ${replacement.pageNumber}`} />
              <figcaption>Original</figcaption>
            </figure>
            <figure>
              <img src={replacement.replacementPreview} alt={`Replacement page ${replacement.pageNumber}`} />
              <figcaption>Replacement</figcaption>
            </figure>
          </div>
        </article>
      ))}
    </section>
  )
}

export function ReplacePagesPage() {
  const [state, dispatch] = useReducer(editorReducer, initialState)
  const isBusy = state.status === 'inspecting' || state.status === 'queueing' || state.status === 'saving'

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
    if (!state.source || !state.book || !state.replacementFile) return

    const pageNumber = Number(state.pageInput)
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > state.book.pageCount) {
      dispatch({ type: 'ready-error', error: `Page number must be between 1 and ${state.book.pageCount}.` })
      return
    }
    if (state.replacements.some((replacement) => replacement.pageNumber === pageNumber)) {
      dispatch({ type: 'ready-error', error: `Page ${pageNumber} already has a queued replacement.` })
      return
    }

    dispatch({ type: 'queue-start' })
    try {
      const [originalBuffer, replacementBuffer] = await Promise.all([
        readXtcPage(state.source, state.book, pageNumber),
        validateXtcPageReplacement(state.book, pageNumber, state.replacementFile),
      ])
      validateXtcPageBuffer(state.book, pageNumber, originalBuffer, 'Original page')

      dispatch({
        type: 'queue-success',
        replacement: {
          pageNumber,
          file: state.replacementFile,
          originalPreview: decodeXtcPageToCanvas(originalBuffer).toDataURL('image/png'),
          replacementPreview: decodeXtcPageToCanvas(replacementBuffer).toDataURL('image/png'),
        },
      })
    } catch (error) {
      dispatch({ type: 'ready-error', error: getErrorMessage(error) })
    }
  }

  const handleSave = async () => {
    if (!state.source || !state.book || state.replacements.length === 0) return

    dispatch({ type: 'save-start' })
    try {
      const replacements: XtcPageReplacement[] = state.replacements.map(({ pageNumber, file }) => ({
        pageNumber,
        file,
      }))
      const output = await createReplacedXtcBlob(state.source, state.book, replacements)
      downloadEditedBook(state.source, state.book, output)
      dispatch({ type: 'save-complete' })
    } catch (error) {
      dispatch({ type: 'ready-error', error: getErrorMessage(error) })
    }
  }

  return (
    <div className="content-section page-replace-page">
      <div className="page-replace-intro">
        <span className="page-replace-eyebrow">XTC / XTCH utility</span>
        <h2>Replace pages without rebuilding the book</h2>
        <p>
          Swap individual raw pages while leaving metadata, page order, and every untouched byte intact.
          XTC books require XTG pages; XTCH books require XTH pages.
        </p>
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
          <ReplacementForm
            book={state.book}
            pageInput={state.pageInput}
            replacementFile={state.replacementFile}
            fileInputVersion={state.fileInputVersion}
            disabled={isBusy}
            checking={state.status === 'queueing'}
            onPageChange={(value) => dispatch({ type: 'set-page', value })}
            onFileChange={(file) => dispatch({ type: 'set-file', file })}
            onSubmit={handleQueue}
          />
          <ReplacementQueue
            replacements={state.replacements}
            disabled={isBusy}
            onRemove={(pageNumber) => dispatch({ type: 'remove', pageNumber })}
          />

          <section className="page-replace-download">
            <button
              type="button"
              className={`btn-convert${state.status === 'saving' ? ' loading' : ''}`}
              disabled={isBusy || state.replacements.length === 0}
              onClick={handleSave}
            >
              <span>
                Download edited book
                {state.replacements.length > 0 ? ` · ${state.replacements.length} page${state.replacements.length === 1 ? '' : 's'}` : ''}
              </span>
            </button>
            <p>Creates a new file. Your uploaded book is never modified or uploaded.</p>
          </section>
        </div>
      )}
    </div>
  )
}
