type PdfData = ArrayBuffer | Uint8Array
type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type PdfWorkerConstructor = new () => Worker

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
  const primaryBytes = clonePdfBytes(data)

  try {
    return await pdfjsLib.getDocument({
      data: primaryBytes,
      disableWorker: !useWorker,
    }).promise
  } catch (error) {
    if (!useWorker || !isRecoverableWorkerError(error)) {
      throw error
    }

    disablePdfWorker()

    return await pdfjsLib.getDocument({
      data: clonePdfBytes(data),
      disableWorker: true,
    }).promise
  }
}

export type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
