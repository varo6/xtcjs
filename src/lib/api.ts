// API client for communicating with Hono backend

const API_BASE = '/api'

export interface ConversionStats {
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

export async function getStats(): Promise<ConversionStats> {
  const response = await fetch(`${API_BASE}/stats`)
  return response.json()
}

export async function recordConversion(data: {
  pageCount: number
  fileSize: number
}): Promise<void> {
  await fetch(`${API_BASE}/stats/conversion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function healthCheck(): Promise<{ status: string; uptime: number }> {
  const response = await fetch(`${API_BASE}/health`)
  return response.json()
}
