import { resolve } from 'node:path'
import type { OpdsConfig, ServerConversionOptions } from './types'

const DEFAULT_LIBRARY_DIR = '/library'
const DEFAULT_CACHE_DIR = '/usr/src/app/data/opds-cache'

function parseDevice(value: string | undefined): ServerConversionOptions['device'] {
  return value === 'X3' ? 'X3' : 'X4'
}

function parseSplitMode(value: string | undefined): ServerConversionOptions['splitMode'] {
  if (value === 'split' || value === 'fourway' || value === 'nosplit') return value
  return 'overlap'
}

function parseDithering(value: string | undefined): ServerConversionOptions['dithering'] {
  if (value === 'atkinson' || value === 'sierra-lite' || value === 'ordered' || value === 'none') return value
  return 'floyd'
}

function parseOrientation(value: string | undefined): ServerConversionOptions['orientation'] {
  return value === 'portrait' ? 'portrait' : 'landscape'
}

function parseInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export function loadOpdsConfig(env: Record<string, string | undefined> = process.env): OpdsConfig {
  const username = env.OPDS_USERNAME || undefined
  const password = env.OPDS_PASSWORD || undefined
  if (Boolean(username) !== Boolean(password)) {
    throw new Error('OPDS_USERNAME and OPDS_PASSWORD must be set together')
  }

  return {
    libraryDir: resolve(env.LIBRARY_DIR || DEFAULT_LIBRARY_DIR),
    cacheDir: resolve(env.OPDS_CACHE_DIR || DEFAULT_CACHE_DIR),
    pageSize: parseInteger(env.OPDS_PAGE_SIZE, 50, 1, 200),
    auth: username && password ? { username, password } : undefined,
    conversion: {
      device: parseDevice(env.XTC_DEVICE),
      splitMode: parseSplitMode(env.XTC_SPLIT_MODE),
      dithering: parseDithering(env.XTC_DITHERING),
      contrast: parseInteger(env.XTC_CONTRAST, 4, 0, 20),
      is2bit: env.XTC_2BIT === 'true',
      orientation: parseOrientation(env.XTC_ORIENTATION),
    },
  }
}
