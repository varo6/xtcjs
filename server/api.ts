import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Database } from 'bun:sqlite'

const api = new Hono()

api.use('*', cors({
  origin: ['https://xtcjs.app', 'http://localhost:5173'],
}))

const FLUSH_INTERVAL_MS = 60 * 60 * 1000

const isBun = typeof globalThis.Bun !== 'undefined'

let db: Database | null = null

const pending = {
  cbz: 0,
  pdf: 0,
}

let pendingTorrent = 0

const memoryStats = {
  daily: [] as { date: string; cbz_count: number; pdf_count: number }[],
  totals: { cbz: 0, pdf: 0 },
  torrent: 0,
}

const rssFields = {
  title: /<title[^>]*><!\[CDATA\[(.+?)\]\]><\/title>|<title[^>]*>(.+?)<\/title>/,
  guid: /<guid[^>]*><!\[CDATA\[(.+?)\]\]><\/guid>|<guid[^>]*>(.+?)<\/guid>/,
  link: /<link[^>]*><!\[CDATA\[(.+?)\]\]><\/link>|<link[^>]*>(.+?)<\/link>/,
  pubDate: /<pubDate[^>]*><!\[CDATA\[(.+?)\]\]><\/pubDate>|<pubDate[^>]*>(.+?)<\/pubDate>/,
} as const

const nyaaFields = {
  infoHash: /<nyaa:infoHash>(.+?)<\/nyaa:infoHash>/,
  size: /<nyaa:size>(.+?)<\/nyaa:size>/,
  seeders: /<nyaa:seeders>(.+?)<\/nyaa:seeders>/,
  leechers: /<nyaa:leechers>(.+?)<\/nyaa:leechers>/,
  downloads: /<nyaa:downloads>(.+?)<\/nyaa:downloads>/,
} as const

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function initDatabase() {
  if (!isBun) {
    console.log('[api] Running without Bun - using in-memory stats only')
    return
  }

  try {
    const { Database } = await import('bun:sqlite')
    const DB_PATH = import.meta.dir + '/../data/stats.db'

    db = new Database(DB_PATH, { create: true })
    db.run('PRAGMA journal_mode = WAL')

    db.run(`
      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT PRIMARY KEY,
        cbz_count INTEGER DEFAULT 0,
        pdf_count INTEGER DEFAULT 0
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS torrent_stats (
        id INTEGER PRIMARY KEY DEFAULT 1,
        count INTEGER DEFAULT 0
      )
    `)
    db.run(`INSERT OR IGNORE INTO torrent_stats (id, count) VALUES (1, 0)`)

    console.log('[api] SQLite database initialized')
  } catch (err) {
    console.warn('[api] Failed to initialize SQLite, using in-memory stats:', err)
  }
}

initDatabase()

function flush() {
  const hasPending = pending.cbz > 0 || pending.pdf > 0
  const hasTorrent = pendingTorrent > 0

  if (!hasPending && !hasTorrent) return

  const date = today()

  if (db) {
    if (hasPending) {
      db.run(`
        INSERT INTO daily_stats (date, cbz_count, pdf_count)
        VALUES (?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          cbz_count = cbz_count + excluded.cbz_count,
          pdf_count = pdf_count + excluded.pdf_count
      `, [date, pending.cbz, pending.pdf])
    }
    if (hasTorrent) {
      db.run(`UPDATE torrent_stats SET count = count + ? WHERE id = 1`, [pendingTorrent])
    }
  } else {
    if (hasPending) {
      const existing = memoryStats.daily.find(d => d.date === date)
      if (existing) {
        existing.cbz_count += pending.cbz
        existing.pdf_count += pending.pdf
      } else {
        memoryStats.daily.unshift({ date, cbz_count: pending.cbz, pdf_count: pending.pdf })
      }
      memoryStats.totals.cbz += pending.cbz
      memoryStats.totals.pdf += pending.pdf
    }
    if (hasTorrent) {
      memoryStats.torrent += pendingTorrent
    }
  }

  pending.cbz = 0
  pending.pdf = 0
  pendingTorrent = 0
}

setInterval(flush, FLUSH_INTERVAL_MS)

if (typeof process !== 'undefined') {
  process.on('SIGINT', () => {
    flush()
    if (db) db.close()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    flush()
    if (db) db.close()
    process.exit(0)
  })
}

api.get('/stats', (c) => {
  const days = Number(c.req.query('days') || 30)

  if (db) {
    const daily = db.query<{ date: string; cbz_count: number; pdf_count: number }, [number]>(`
      SELECT date, cbz_count, pdf_count
      FROM daily_stats
      WHERE date >= date('now', '-' || ? || ' days')
      ORDER BY date DESC
    `).all(days)

    const totals = db.query<{ cbz: number; pdf: number }, []>(`
      SELECT
        COALESCE(SUM(cbz_count), 0) as cbz,
        COALESCE(SUM(pdf_count), 0) as pdf
      FROM daily_stats
    `).get()!

    const torrentRow = db.query<{ count: number }, []>(`SELECT count FROM torrent_stats WHERE id = 1`).get()
    const torrentTotal = (torrentRow?.count ?? 0) + pendingTorrent

    return c.json({
      pending: { ...pending },
      totals: {
        cbz: totals.cbz + pending.cbz,
        pdf: totals.pdf + pending.pdf,
        total: totals.cbz + totals.pdf + pending.cbz + pending.pdf,
      },
      torrent: torrentTotal,
      daily,
    })
  }

  return c.json({
    pending: { ...pending },
    totals: {
      cbz: memoryStats.totals.cbz + pending.cbz,
      pdf: memoryStats.totals.pdf + pending.pdf,
      total: memoryStats.totals.cbz + memoryStats.totals.pdf + pending.cbz + pending.pdf,
    },
    torrent: memoryStats.torrent + pendingTorrent,
    daily: memoryStats.daily.slice(0, days),
  })
})

api.post('/stats/conversion', async (c) => {
  const body = await c.req.json<{ type: 'cbz' | 'pdf' | 'torrent' }>()

  if (body.type === 'cbz') {
    pending.cbz++
  } else if (body.type === 'pdf') {
    pending.pdf++
  } else if (body.type === 'torrent') {
    pendingTorrent++
  }

  return c.json({ success: true })
})

api.post('/stats/flush', (c) => {
  flush()
  return c.json({ success: true, message: 'Flushed to database' })
})

api.get('/nyaa', async (c) => {
  const q = c.req.query('q')
  if (!q) return c.json([])

  try {
    const url = `https://nyaa.si/?page=rss&c=3_1&f=0&q=${encodeURIComponent(q)}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Nyaa returned ${res.status}`)
    const xml = await res.text()

    const items: any[] = []
    const itemRegex = /<item>([\s\S]*?)<\/item>/g
    let match
    while ((match = itemRegex.exec(xml)) !== null) {
      const content = match[1]
      const get = (tag: keyof typeof rssFields) => {
        const m = content.match(rssFields[tag])
        return m ? (m[1] || m[2] || '') : ''
      }
      const getNs = (tag: keyof typeof nyaaFields) => {
        const m = content.match(nyaaFields[tag])
        return m ? m[1] : ''
      }

      const infoHash = getNs('infoHash')
      items.push({
        title: get('title'),
        link: get('guid'),
        torrent: get('link'),
        size: getNs('size'),
        date: new Date(get('pubDate')).toLocaleDateString(),
        seeders: parseInt(getNs('seeders')) || 0,
        leechers: parseInt(getNs('leechers')) || 0,
        downloads: parseInt(getNs('downloads')) || 0,
        magnet: infoHash ? `magnet:?xt=urn:btih:${infoHash}` : '',
      })
    }

    items.sort((a, b) => b.seeders - a.seeders)
    return c.json(items)
  } catch (err) {
    console.error('[api] Nyaa search error:', err)
    return c.json({ error: 'Search failed' }, 500)
  }
})

api.get('/health', (c) => {
  return c.json({
    status: 'ok',
    uptime: typeof process !== 'undefined' ? process.uptime() : 0,
    timestamp: new Date().toISOString(),
    pending: { ...pending },
    storage: db ? 'sqlite' : 'memory',
  })
})

export { api }
