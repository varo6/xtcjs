import { afterEach, describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import sharp from 'sharp'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { convertCbzFileToXtc, getOverlapSegments } from './cbz-converter'
import type { ServerConversionOptions } from './types'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'xtcjs-converter-'))
  tempDirs.push(dir)
  return dir
}

async function writeImageCbz(path: string): Promise<void> {
  const png = await sharp({
    create: {
      width: 120,
      height: 180,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{
      input: await sharp({
        create: {
          width: 60,
          height: 80,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        },
      }).png().toBuffer(),
      left: 30,
      top: 40,
    }])
    .png()
    .toBuffer()

  const zip = new JSZip()
  zip.file('001.png', png)
  await writeFile(path, Buffer.from(await zip.generateAsync({ type: 'uint8array' })))
}

function options(overrides: Partial<ServerConversionOptions> = {}): ServerConversionOptions {
  return {
    device: 'X4',
    splitMode: 'nosplit',
    dithering: 'none',
    contrast: 0,
    is2bit: false,
    orientation: 'portrait',
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('convertCbzFileToXtc', () => {
  test('uses the X3 aspect ratio for overlapping segments', () => {
    const [first] = getOverlapSegments(120, 180, { width: 528, height: 792 })

    expect(first.height).toBe(80)
  })

  test('converts a tiny CBZ to a valid XTC with X4 page dimensions', async () => {
    const dir = await makeTempDir()
    const cbzPath = join(dir, 'book.cbz')
    await writeImageCbz(cbzPath)

    const result = await convertCbzFileToXtc(cbzPath, options())
    const view = new DataView(result)

    expect(String.fromCharCode(...new Uint8Array(result, 0, 3))).toBe('XTC')
    expect(view.getUint16(6, true)).toBe(1)
    expect(view.getUint16(60, true)).toBe(480)
    expect(view.getUint16(62, true)).toBe(800)
  })

  test('converts to XTCH when 2-bit output is enabled', async () => {
    const dir = await makeTempDir()
    const cbzPath = join(dir, 'book.cbz')
    await writeImageCbz(cbzPath)

    const result = await convertCbzFileToXtc(cbzPath, options({ is2bit: true }))

    expect(String.fromCharCode(...new Uint8Array(result, 0, 4))).toBe('XTCH')
  })
})
