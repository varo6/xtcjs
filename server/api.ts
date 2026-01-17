import { Hono } from 'hono'

const api = new Hono()

// Track conversion statistics
interface ConversionStats {
  totalConversions: number
  totalPages: number
  totalBytes: number
  lastConversion: string | null
  conversionHistory: Array<{
    timestamp: string
    pageCount: number
    fileSize: number
  }>
}

const stats: ConversionStats = {
  totalConversions: 0,
  totalPages: 0,
  totalBytes: 0,
  lastConversion: null,
  conversionHistory: [],
}

// Get current statistics
api.get('/stats', (c) => {
  return c.json({
    ...stats,
    conversionHistory: stats.conversionHistory.slice(-10), // Last 10 only
  })
})

// Record a conversion
api.post('/stats/conversion', async (c) => {
  const body = await c.req.json<{
    pageCount: number
    fileSize: number
  }>()

  const timestamp = new Date().toISOString()

  stats.totalConversions++
  stats.totalPages += body.pageCount
  stats.totalBytes += body.fileSize
  stats.lastConversion = timestamp

  stats.conversionHistory.push({
    timestamp,
    pageCount: body.pageCount,
    fileSize: body.fileSize,
  })

  // Keep only last 100 entries in memory
  if (stats.conversionHistory.length > 100) {
    stats.conversionHistory = stats.conversionHistory.slice(-100)
  }

  return c.json({ success: true, stats })
})

// Health check
api.get('/health', (c) => {
  return c.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})

export { api }
