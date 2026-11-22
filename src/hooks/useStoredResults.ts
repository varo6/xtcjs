import { useState, useEffect, useCallback, useRef } from 'react'
import {
  isStorageAvailable,
  openDatabase,
  generateSessionId,
  storeConversion,
  getConversionData,
  getConversionPreviews,
  deleteConversion,
  deleteSessionConversions,
  clearAllConversions,
  cleanupExpiredConversions,
  getSessionConversionRefs,
  getRecoveredConversionRefs,
  type StoredConversionRef,
} from '../lib/storage'
import type { ConversionResult } from '../lib/conversion/types'

export interface StoredResult extends StoredConversionRef {}

export function withoutStoredResult<T extends { id: string }>(results: T[], id: string): T[] {
  return results.filter((result) => result.id !== id)
}

export async function deleteStoredResult(
  result: Pick<StoredResult, 'id'>,
  deletePersisted: (id: string) => Promise<void> = deleteConversion,
): Promise<boolean> {
  if (result.id.startsWith('mem-')) return true

  try {
    await deletePersisted(result.id)
    return true
  } catch {
    return false
  }
}

interface UseStoredResultsReturn {
  results: StoredResult[]
  recoveredResults: StoredResult[]
  recoveredCount: number
  isStorageEnabled: boolean
  addResult: (result: ConversionResult) => Promise<StoredResult | null>
  clearSession: () => Promise<void>
  clearAll: () => Promise<void>
  dismissRecovered: () => void
  removeResult: (result: StoredResult) => Promise<boolean>
  downloadResult: (result: StoredResult) => Promise<void>
  getPreviewImages: (result: StoredResult) => Promise<string[]>
  getResultData: (result: StoredResult) => Promise<ArrayBuffer | null>
}

export function useStoredResults(): UseStoredResultsReturn {
  const [results, setResults] = useState<StoredResult[]>([])
  const [recoveredResults, setRecoveredResults] = useState<StoredResult[]>([])
  const [isStorageEnabled, setIsStorageEnabled] = useState(false)
  const sessionIdRef = useRef<string>('')

  useEffect(() => {
    const init = async () => {
      if (!isStorageAvailable()) {
        console.warn('IndexedDB not available, using in-memory fallback')
        return
      }

      try {
        await openDatabase()
        setIsStorageEnabled(true)

        sessionIdRef.current = generateSessionId()

        const deletedCount = await cleanupExpiredConversions()
        if (deletedCount > 0) {
          console.log(`Cleaned up ${deletedCount} expired conversions`)
        }

        const recovered = await getRecoveredConversionRefs(sessionIdRef.current)
        if (recovered.length > 0) {
          setRecoveredResults(recovered)
        }
      } catch (err) {
        console.error('Failed to initialize storage:', err)
      }
    }

    init()
  }, [])

  const addResult = useCallback(async (result: ConversionResult): Promise<StoredResult | null> => {
    if (!isStorageEnabled || !sessionIdRef.current) {
      const fakeRef: StoredResult = {
        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        sessionId: 'in-memory',
        name: result.name,
        size: result.size || 0,
        pageCount: result.pageCount || 0,
        error: result.error,
        createdAt: Date.now(),
        expiresAt: Date.now() + 4.5 * 60 * 60 * 1000,
        status: result.error ? 'error' : 'complete',
      }
      setResults(prev => [...prev, fakeRef])
      return fakeRef
    }

    try {
      const ref = await storeConversion(sessionIdRef.current, result)
      setResults(prev => [...prev, ref])
      return ref
    } catch (err) {
      console.error('Failed to store conversion:', err)
      const fakeRef: StoredResult = {
        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        sessionId: sessionIdRef.current,
        name: result.name,
        size: result.size || 0,
        pageCount: result.pageCount || 0,
        error: result.error,
        createdAt: Date.now(),
        expiresAt: Date.now() + 4.5 * 60 * 60 * 1000,
        status: result.error ? 'error' : 'complete',
      }
      setResults(prev => [...prev, fakeRef])
      return fakeRef
    }
  }, [isStorageEnabled])

  const clearSession = useCallback(async () => {
    if (isStorageEnabled && sessionIdRef.current) {
      try {
        await deleteSessionConversions(sessionIdRef.current)
      } catch (err) {
        console.error('Failed to clear session:', err)
      }
    }
    setResults([])
  }, [isStorageEnabled])

  const clearAll = useCallback(async () => {
    if (isStorageEnabled) {
      try {
        await clearAllConversions()
      } catch (err) {
        console.error('Failed to clear all:', err)
      }
    }
    setResults([])
    setRecoveredResults([])
  }, [isStorageEnabled])

  const dismissRecovered = useCallback(() => {
    setRecoveredResults([])
  }, [])

  const removeResult = useCallback(async (result: StoredResult): Promise<boolean> => {
    if (!await deleteStoredResult(result)) {
      console.error('Failed to remove result')
      return false
    }

    setResults((prev) => withoutStoredResult(prev, result.id))
    setRecoveredResults((prev) => withoutStoredResult(prev, result.id))
    return true
  }, [])

  const downloadResult = useCallback(async (result: StoredResult): Promise<void> => {
    if (result.error) return

    try {
      const data = await getConversionData(result.id)
      if (!data || data.byteLength === 0) {
        throw new Error('File data not found')
      }

      const blob = new Blob([data], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = result.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to download:', err)
      throw err
    }
  }, [])

  const getPreviewImages = useCallback(async (result: StoredResult): Promise<string[]> => {
    try {
      const images = await getConversionPreviews(result.id)
      return images || []
    } catch (err) {
      console.error('Failed to get previews:', err)
      return []
    }
  }, [])

  const getResultData = useCallback(async (result: StoredResult): Promise<ArrayBuffer | null> => {
    if (result.error) return null
    try {
      return await getConversionData(result.id)
    } catch (err) {
      console.error('Failed to get conversion data:', err)
      return null
    }
  }, [])

  return {
    results,
    recoveredResults,
    recoveredCount: recoveredResults.length,
    isStorageEnabled,
    addResult,
    clearSession,
    clearAll,
    dismissRecovered,
    removeResult,
    downloadResult,
    getPreviewImages,
    getResultData,
  }
}
