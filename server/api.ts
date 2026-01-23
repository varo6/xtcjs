import { Hono } from 'hono'

const api = new Hono()

// Config
const FLUSH_INTERVAL_MS = 60 * 60 * 1000 // 1 hour default

// Check if running in Bun (has bun:sqlite available)
const isBun = typeof globalThis.Bun !== 'undefined'

// Database instance (only available in Bun)
let db: any = null

// In-memory counters (flushed periodically when db available)
const pending = {
  cbz: 0,
  pdf: 0,
}

// In-memory fallback for dev mode without Bun
const memoryStats = {
  daily: [] as { date: string; cbz_count: number; pdf_count: number }[],
  totals: { cbz: 0, pdf: 0 },
}

// Get today's date as YYYY-MM-DD
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// Initialize SQLite only in Bun environment
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

    // Create tables
    db.run(`
      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT PRIMARY KEY,
        cbz_count INTEGER DEFAULT 0,
        pdf_count INTEGER DEFAULT 0
      )
    `)

    console.log('[api] SQLite database initialized')
  } catch (err) {
    console.warn('[api] Failed to initialize SQLite, using in-memory stats:', err)
  }
}

// Initialize on module load
initDatabase()

// Flush pending counters to SQLite
function flush() {
  if (pending.cbz === 0 && pending.pdf === 0) return

  const date = today()

  if (db) {
    db.run(`
      INSERT INTO daily_stats (date, cbz_count, pdf_count)
      VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        cbz_count = cbz_count + excluded.cbz_count,
        pdf_count = pdf_count + excluded.pdf_count
    `, [date, pending.cbz, pending.pdf])
  } else {
    // In-memory fallback
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

  pending.cbz = 0
  pending.pdf = 0
}

// Periodic flush
setInterval(flush, FLUSH_INTERVAL_MS)

// Flush on shutdown
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

// Get statistics
api.get('/stats', (c) => {
  const days = Number(c.req.query('days') || 30)

  if (db) {
    // Get daily stats for last N days
    const daily = db.query<{ date: string; cbz_count: number; pdf_count: number }, [number]>(`
      SELECT date, cbz_count, pdf_count
      FROM daily_stats
      WHERE date >= date('now', '-' || ? || ' days')
      ORDER BY date DESC
    `).all(days)

    // Calculate totals
    const totals = db.query<{ cbz: number; pdf: number }, []>(`
      SELECT
        COALESCE(SUM(cbz_count), 0) as cbz,
        COALESCE(SUM(pdf_count), 0) as pdf
      FROM daily_stats
    `).get()!

    return c.json({
      pending: { ...pending },
      totals: {
        cbz: totals.cbz + pending.cbz,
        pdf: totals.pdf + pending.pdf,
        total: totals.cbz + totals.pdf + pending.cbz + pending.pdf,
      },
      daily,
    })
  }

  // In-memory fallback response
  return c.json({
    pending: { ...pending },
    totals: {
      cbz: memoryStats.totals.cbz + pending.cbz,
      pdf: memoryStats.totals.pdf + pending.pdf,
      total: memoryStats.totals.cbz + memoryStats.totals.pdf + pending.cbz + pending.pdf,
    },
    daily: memoryStats.daily.slice(0, days),
  })
})

// Record a conversion
api.post('/stats/conversion', async (c) => {
  const body = await c.req.json<{ type: 'cbz' | 'pdf' }>()

  if (body.type === 'cbz') {
    pending.cbz++
  } else if (body.type === 'pdf') {
    pending.pdf++
  }

  return c.json({ success: true })
})

// Force flush (for admin/debugging)
api.post('/stats/flush', (c) => {
  flush()
  return c.json({ success: true, message: 'Flushed to database' })
})

// Health check
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
