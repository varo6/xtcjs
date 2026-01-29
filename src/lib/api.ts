// API client for communicating with Hono backend

// In production with separate API server, set VITE_API_URL=https://api.xtcjs.app/api
export const API_BASE = import.meta.env.VITE_API_URL || '/api'

export interface DailyStats {
  date: string
  cbz_count: number
  pdf_count: number
}

export interface Stats {
  pending: { cbz: number; pdf: number }
  totals: { cbz: number; pdf: number; total: number }
  daily: DailyStats[]
}

export async function getStats(days = 30): Promise<Stats> {
  const response = await fetch(`${API_BASE}/stats?days=${days}`)
  return response.json()
}

export async function recordConversion(type: 'cbz' | 'pdf'): Promise<void> {
  await fetch(`${API_BASE}/stats/conversion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
  })
}

export async function healthCheck(): Promise<{
  status: string
  uptime: number
  pending: { cbz: number; pdf: number }
}> {
  const response = await fetch(`${API_BASE}/health`)
  return response.json()
}
