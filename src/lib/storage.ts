// IndexedDB storage for crash-resilient conversion results

const DB_NAME = 'xtcjs-storage'
const DB_VERSION = 1
const STORE_NAME = 'conversions'
const EXPIRATION_MS = 4.5 * 60 * 60 * 1000 // 4.5 hours

export interface StoredConversion {
  id: string
  sessionId: string
  name: string
  data: ArrayBuffer
  size: number
  pageCount: number
  pageImages: string[]
  error?: string
  createdAt: number
  expiresAt: number
  status: 'complete' | 'error'
}

export type StoredConversionRef = Omit<StoredConversion, 'data' | 'pageImages'>

let dbInstance: IDBDatabase | null = null
let dbError: Error | null = null

/**
 * Initialize and open the IndexedDB database
 */
export async function openDatabase(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance
  if (dbError) throw dbError

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      dbError = new Error('Failed to open IndexedDB')
      reject(dbError)
    }

    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('sessionId', 'sessionId', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
        store.createIndex('expiresAt', 'expiresAt', { unique: false })
      }
    }
  })
}

/**
 * Check if IndexedDB is available
 */
export function isStorageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Generate a unique conversion ID
 */
function generateId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Store a conversion result in IndexedDB
 */
export async function storeConversion(
  sessionId: string,
  conversion: {
    name: string
    data?: ArrayBuffer
    size?: number
    pageCount?: number
    pageImages?: string[]
    error?: string
  }
): Promise<StoredConversionRef> {
  const db = await openDatabase()
  const now = Date.now()

  const record: StoredConversion = {
    id: generateId(),
    sessionId,
    name: conversion.name,
    data: conversion.data || new ArrayBuffer(0),
    size: conversion.size || 0,
    pageCount: conversion.pageCount || 0,
    pageImages: conversion.pageImages || [],
    error: conversion.error,
    createdAt: now,
    expiresAt: now + EXPIRATION_MS,
    status: conversion.error ? 'error' : 'complete',
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.add(record)

    request.onerror = () => reject(new Error('Failed to store conversion'))
    request.onsuccess = () => {
      // Return ref without large data
      const { data, pageImages, ...ref } = record
      resolve(ref)
    }
  })
}

/**
 * Get a full conversion record by ID
 */
export async function getConversion(id: string): Promise<StoredConversion | null> {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(id)

    request.onerror = () => reject(new Error('Failed to get conversion'))
    request.onsuccess = () => resolve(request.result || null)
  })
}

/**
 * Get just the ArrayBuffer data for download
 */
export async function getConversionData(id: string): Promise<ArrayBuffer | null> {
  const record = await getConversion(id)
  return record?.data || null
}

/**
 * Get just the preview images
 */
export async function getConversionPreviews(id: string): Promise<string[] | null> {
  const record = await getConversion(id)
  return record?.pageImages || null
}

/**
 * Delete a conversion record
 */
export async function deleteConversion(id: string): Promise<void> {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.delete(id)

    request.onerror = () => reject(new Error('Failed to delete conversion'))
    request.onsuccess = () => resolve()
  })
}

/**
 * Delete multiple conversions
 */
export async function deleteConversions(ids: string[]): Promise<void> {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    let completed = 0
    let hasError = false

    for (const id of ids) {
      const request = store.delete(id)
      request.onerror = () => {
        if (!hasError) {
          hasError = true
          reject(new Error('Failed to delete conversions'))
        }
      }
      request.onsuccess = () => {
        completed++
        if (completed === ids.length && !hasError) {
          resolve()
        }
      }
    }

    if (ids.length === 0) resolve()
  })
}

/**
 * Get all unexpired conversion refs (without large data)
 */
export async function getAllConversionRefs(): Promise<StoredConversionRef[]> {
  const db = await openDatabase()
  const now = Date.now()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onerror = () => reject(new Error('Failed to get conversions'))
    request.onsuccess = () => {
      const results: StoredConversionRef[] = []
      for (const record of request.result as StoredConversion[]) {
        if (record.expiresAt > now) {
          // Return ref without large data
          const { data, pageImages, ...ref } = record
          results.push(ref)
        }
      }
      // Sort by creation time, newest first
      results.sort((a, b) => b.createdAt - a.createdAt)
      resolve(results)
    }
  })
}

/**
 * Get conversions for a specific session
 */
export async function getSessionConversionRefs(sessionId: string): Promise<StoredConversionRef[]> {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const index = store.index('sessionId')
    const request = index.getAll(sessionId)

    request.onerror = () => reject(new Error('Failed to get session conversions'))
    request.onsuccess = () => {
      const results: StoredConversionRef[] = []
      for (const record of request.result as StoredConversion[]) {
        const { data, pageImages, ...ref } = record
        results.push(ref)
      }
      results.sort((a, b) => a.createdAt - b.createdAt)
      resolve(results)
    }
  })
}

/**
 * Delete all conversions in a session
 */
export async function deleteSessionConversions(sessionId: string): Promise<void> {
  const refs = await getSessionConversionRefs(sessionId)
  await deleteConversions(refs.map(r => r.id))
}

/**
 * Clean up expired conversions
 */
export async function cleanupExpiredConversions(): Promise<number> {
  const db = await openDatabase()
  const now = Date.now()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const index = store.index('expiresAt')
    const range = IDBKeyRange.upperBound(now)
    const request = index.openCursor(range)

    let deletedCount = 0

    request.onerror = () => reject(new Error('Failed to cleanup conversions'))
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
      if (cursor) {
        cursor.delete()
        deletedCount++
        cursor.continue()
      } else {
        resolve(deletedCount)
      }
    }
  })
}

/**
 * Get IDs of conversions from previous sessions (not in current session)
 */
export async function getRecoveredConversionRefs(currentSessionId: string): Promise<StoredConversionRef[]> {
  const all = await getAllConversionRefs()
  return all.filter(r => r.sessionId !== currentSessionId)
}

/**
 * Clear all stored conversions
 */
export async function clearAllConversions(): Promise<void> {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.clear()

    request.onerror = () => reject(new Error('Failed to clear conversions'))
    request.onsuccess = () => resolve()
  })
}
