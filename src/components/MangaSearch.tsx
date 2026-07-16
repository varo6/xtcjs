import { useState, useEffect, useRef, useCallback, useEffectEvent } from 'react'
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
  const wasOpenRef = useRef(open)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NyaaResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  if (wasOpenRef.current !== open) {
    wasOpenRef.current = open
    if (!open) {
      setQuery('')
      setResults([])
      setError('')
    }
  }

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
      setError('search-unavailable')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])
  const searchEvent = useEffectEvent((q: string) => {
    search(q)
  })
  const closeEvent = useEffectEvent(() => {
    onClose()
  })

  useEffect(() => {
    if (open) {
      const focusTimer = setTimeout(() => inputRef.current?.focus(), 100)
      return () => clearTimeout(focusTimer)
    }
  }, [open])

  // Debounce at 800ms, or search immediately on Enter
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim()) {
      debounceRef.current = setTimeout(() => searchEvent(query), 800)
    } else {
      setResults([])
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      search(query)
    }
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeEvent()
    }
    if (open) window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open])

  if (!open) return null

  return (
    <div className="manga-search-overlay" onClick={onClose} role="presentation">
      <div className="manga-search-modal" onClick={(e) => e.stopPropagation()} role="presentation">
        <div className="manga-search-header">
          <div className="manga-search-header-top">
            <h2>Search Manga</h2>
            <a href="https://thewiki.moe/getting-started/torrenting/" target="_blank" rel="noopener" className="manga-search-hint-underline">
              What is this torrent thing?
            </a>
            <button type="button" className="manga-search-close" onClick={onClose} aria-label="Close">
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
            aria-label="Search nyaa.si"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {loading && <span className="manga-search-spinner" />}
        </div>

        <div className="manga-search-results">
          {error === 'search-unavailable' && (
            <div className="manga-search-error">
              <p>The search server is currently unavailable.</p>
              <p>
                You can search directly on{' '}
                <a
                  href={`https://nyaa.si/?f=0&c=3_1&q=${encodeURIComponent(query)}`}
                  target="_blank"
                  rel="noopener"
                >
                  nyaa.si
                </a>{' '}
                to find English-translated manga.
              </p>
            </div>
          )}
          {!loading && !error && query && results.length === 0 && (
            <p className="manga-search-empty">No results found</p>
          )}
          {results.map((r) => (
            <div key={r.link || r.torrent || r.magnet || r.title} className="manga-search-item">
              <a className="manga-search-item-title" href={r.link} target="_blank" rel="noopener">
                {r.title}
              </a>
              <div className="manga-search-item-meta">
                <span>{r.size}</span>
                <span className="manga-search-seed">S: {r.seeders}</span>
                <span className="manga-search-leech">L: {r.leechers}</span>
                <span>{r.date}</span>
              </div>
              <div className="manga-search-item-actions">
                <a href={r.magnet} className="manga-search-magnet" title="Magnet link" onClick={trackTorrentClick}>
                  Magnet
                </a>
                <a href={r.torrent} className="manga-search-magnet" title="Torrent file" onClick={trackTorrentClick}>
                  .torrent
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
