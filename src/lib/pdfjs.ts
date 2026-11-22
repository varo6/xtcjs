type PdfData = ArrayBuffer | Uint8Array
type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfWorkerConstructor = new () => Worker

export function getPdfJsWasmUrl(isDevelopment: boolean, baseUrl: string): string {
  return isDevelopment ? '/node_modules/pdfjs-dist/wasm/' : `${baseUrl}pdfjs/wasm/`
}

export const PDFJS_WASM_URL = getPdfJsWasmUrl(import.meta.env.DEV, import.meta.env.BASE_URL ?? '/')

let sharedWorker: Worker | null = null
let workerDisabled = false
let pdfJsModuleCache: PdfJsModule | null = null
let pdfJsModulePromise: Promise<PdfJsModule> | null = null
let pdfWorkerPromise: Promise<PdfWorkerConstructor> | null = null

function toPdfBytes(data: PdfData): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

function clonePdfBytes(data: PdfData): Uint8Array {
  return toPdfBytes(data).slice()
}

async function loadPdfJsModule(): Promise<PdfJsModule> {
  if (pdfJsModuleCache) {
    return pdfJsModuleCache
  }

  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((module) => {
      pdfJsModuleCache = module
      return module
    })
  }

  return pdfJsModulePromise
}

async function loadPdfWorker(): Promise<PdfWorkerConstructor> {
  if (!pdfWorkerPromise) {
    pdfWorkerPromise = import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline')
      .then((module) => module.default as PdfWorkerConstructor)
  }

  return pdfWorkerPromise
}

// pdf.js v5 has no disableWorker option. With no workerPort it runs the worker
// code on this thread only if globalThis.pdfjsWorker is set, which importing
// the worker module does.
async function loadMainThreadPdfWorker(): Promise<void> {
  await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs')
}

function disablePdfWorker(): void {
  if (sharedWorker) {
    sharedWorker.terminate()
    sharedWorker = null
  }
  if (pdfJsModuleCache) {
    pdfJsModuleCache.GlobalWorkerOptions.workerPort = null
  }
  workerDisabled = true
}

// A worker that cannot run (blocked by CSP, failed to evaluate) does not throw
// from its constructor; it only fires 'error'. pdf.js would wait on its port
// forever, so wait for the "ready" message the pdf.js worker posts on startup.
function waitForWorkerStart(worker: Worker): Promise<boolean> {
  return new Promise((resolve) => {
    worker.addEventListener('message', () => resolve(true), { once: true })
    worker.addEventListener('error', () => resolve(false), { once: true })
  })
}

async function ensurePdfWorker(pdfjsLib: PdfJsModule): Promise<boolean> {
  if (workerDisabled || typeof Worker === 'undefined') {
    return false
  }

  if (sharedWorker) {
    return true
  }

  try {
    const PdfJsWorker = await loadPdfWorker()
    const worker = new PdfJsWorker()
    if (!await waitForWorkerStart(worker)) {
      worker.terminate()
      disablePdfWorker()
      return false
    }
    worker.addEventListener('error', () => {
      if (sharedWorker === worker) {
        disablePdfWorker()
      }
    })
    pdfjsLib.GlobalWorkerOptions.workerPort = worker
    sharedWorker = worker
    return true
  } catch {
    disablePdfWorker()
    return false
  }
}

function isRecoverableWorkerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Setting up fake worker failed') ||
    message.includes('Cannot use more than one PDFWorker per port') ||
    message.includes('The worker has been disabled') ||
    message.includes('Failed to fetch dynamically imported module')
}

export async function loadPdfDocument(data: PdfData) {
  const pdfjsLib = await loadPdfJsModule()
  const useWorker = await ensurePdfWorker(pdfjsLib)
  if (!useWorker) {
    await loadMainThreadPdfWorker()
  }

  try {
    return await pdfjsLib.getDocument({
      data: clonePdfBytes(data),
      wasmUrl: PDFJS_WASM_URL,
    }).promise
  } catch (error) {
    if (!useWorker || !isRecoverableWorkerError(error)) {
      throw error
    }

    disablePdfWorker()
    await loadMainThreadPdfWorker()

    return await pdfjsLib.getDocument({
      data: clonePdfBytes(data),
      wasmUrl: PDFJS_WASM_URL,
    }).promise
  }
}

export type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
