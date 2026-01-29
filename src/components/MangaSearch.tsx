import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../lib/api'
import '../styles/manga-search.css'

interface NyaaResult {
  title: string
  link: string
  torrent: string
  size: string
  date: string
  seeders: number
  leechers: number
  downloads: number
  magnet: string
}

function trackTorrentClick() {
  axios.post(`${API_BASE}/stats/conversion`, { type: 'torrent' }).catch(() => {})
}

export function MangaSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NyaaResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`${API_BASE}/nyaa`, {
        params: { q },
      })
      if (!Array.isArray(data)) throw new Error('Invalid response')
      setResults(data)
    } catch {
      setError('Failed to fetch results')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      setQuery('')
      setResults([])
      setError('')
    }
  }, [open])

  // Debounce at 800ms, or search immediately on Enter
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim()) {
      debounceRef.current = setTimeout(() => search(query), 800)
    } else {
      setResults([])
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, search])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      search(query)
    }
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="manga-search-overlay" onClick={onClose}>
      <div className="manga-search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="manga-search-header">
          <div className="manga-search-header-top">
            <h2>Search Manga</h2>
            <a href="https://thewiki.moe/getting-started/torrenting/" target="_blank" rel="noopener" className="manga-search-hint-underline">
              What is this torrent thing?
            </a>
            <button className="manga-search-close" onClick={onClose} aria-label="Close">
              &times;
            </button>
          </div>
          <p className="manga-search-hint">
            If you are experiencing high latency, visit{' '}
            <a href="https://nyaa.si" target="_blank" rel="noopener">nyaa.si</a>
          </p>
        </div>

        <div className="manga-search-input-wrap">
          <input
            ref={inputRef}
            type="text"
            className="manga-search-input"
            placeholder="Search nyaa.si (English Translated)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {loading && <span className="manga-search-spinner" />}
        </div>

        <div className="manga-search-results">
          {error && <p className="manga-search-error">{error}</p>}
          {!loading && !error && query && results.length === 0 && (
            <p className="manga-search-empty">No results found</p>
          )}
          {results.map((r, i) => (
            <a key={i} className="manga-search-item" href={r.link} target="_blank" rel="noopener">
              <div className="manga-search-item-title">{r.title}</div>
              <div className="manga-search-item-meta">
                <span>{r.size}</span>
                <span className="manga-search-seed">S: {r.seeders}</span>
                <span className="manga-search-leech">L: {r.leechers}</span>
                <span>{r.date}</span>
              </div>
              <div className="manga-search-item-actions" onClick={(e) => e.stopPropagation()}>
                <a href={r.magnet} className="manga-search-magnet" title="Magnet link" onClick={(e) => { e.stopPropagation(); trackTorrentClick() }}>
                  Magnet
                </a>
                <a href={r.torrent} className="manga-search-magnet" title="Torrent file" onClick={(e) => { e.stopPropagation(); trackTorrentClick() }}>
                  .torrent
                </a>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
