import { useState, useEffect, useCallback, useRef } from 'react'
import {
  isStorageAvailable,
  openDatabase,
  generateSessionId,
  storeConversion,
  getConversionData,
  getConversionPreviews,
  deleteSessionConversions,
  clearAllConversions,
  cleanupExpiredConversions,
  getSessionConversionRefs,
  getRecoveredConversionRefs,
  type StoredConversionRef,
} from '../lib/storage'
import type { ConversionResult } from '../lib/converter'

export interface StoredResult extends StoredConversionRef {
  // For compatibility with ConversionResult interface used by Results component
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
  downloadResult: (result: StoredResult) => Promise<void>
  getPreviewImages: (result: StoredResult) => Promise<string[]>
}

export function useStoredResults(): UseStoredResultsReturn {
  const [results, setResults] = useState<StoredResult[]>([])
  const [recoveredResults, setRecoveredResults] = useState<StoredResult[]>([])
  const [isStorageEnabled, setIsStorageEnabled] = useState(false)
  const sessionIdRef = useRef<string>('')

  // Initialize storage and load recovered results
  useEffect(() => {
    const init = async () => {
      if (!isStorageAvailable()) {
        console.warn('IndexedDB not available, using in-memory fallback')
        return
      }

      try {
        await openDatabase()
        setIsStorageEnabled(true)

        // Generate session ID
        sessionIdRef.current = generateSessionId()

        // Clean up expired conversions
        const deletedCount = await cleanupExpiredConversions()
        if (deletedCount > 0) {
          console.log(`Cleaned up ${deletedCount} expired conversions`)
        }

        // Load recovered results from previous sessions
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

  // Add a new conversion result
  const addResult = useCallback(async (result: ConversionResult): Promise<StoredResult | null> => {
    if (!isStorageEnabled || !sessionIdRef.current) {
      // Fallback: just return a fake ref for in-memory mode
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
      // Fallback to in-memory
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

  // Clear current session results
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

  // Clear all results including recovered
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

  // Dismiss recovered results banner without deleting data
  const dismissRecovered = useCallback(() => {
    setRecoveredResults([])
  }, [])

  // Download a result by fetching data from IndexedDB
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

  // Get preview images from IndexedDB
  const getPreviewImages = useCallback(async (result: StoredResult): Promise<string[]> => {
    try {
      const images = await getConversionPreviews(result.id)
      return images || []
    } catch (err) {
      console.error('Failed to get previews:', err)
      return []
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
    downloadResult,
    getPreviewImages,
  }
}
