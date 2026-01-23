// Shared state for transferring files between pages

type TransferListener = (files: File[]) => void

let pendingFiles: File[] = []
let listeners: TransferListener[] = []

export function setPendingFiles(files: File[]) {
  pendingFiles = files
  listeners.forEach(fn => fn(files))
}

export function getPendingFiles(): File[] {
  return pendingFiles
}

export function clearPendingFiles() {
  pendingFiles = []
  listeners.forEach(fn => fn([]))
}

export function consumePendingFiles(): File[] {
  const files = pendingFiles
  pendingFiles = []
  return files
}

export function subscribeToPendingFiles(fn: TransferListener): () => void {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter(l => l !== fn)
  }
}

export function arrayBufferToFile(buffer: ArrayBuffer, name: string): File {
  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  return new File([blob], name, { type: blob.type })
}
