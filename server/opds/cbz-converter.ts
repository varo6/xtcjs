import JSZip from 'jszip'
import sharp from 'sharp'
import { buildXtcFromXtgPages } from './xtc-format'
import { applyContrastRgba, applyDitheringRgba, rgbaToXtg, rgbaToXth, toGrayscaleRgba } from './pixels'
import type { ServerConversionOptions } from './types'

interface Segment {
  left: number
  top: number
  width: number
  height: number
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'])

export async function convertCbzFileToXtc(path: string, options: ServerConversionOptions): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(await Bun.file(path).arrayBuffer())
  const entries: Array<{ path: string; entry: JSZip.JSZipObject }> = []

  zip.forEach((relativePath, entry) => {
    if (entry.dir || relativePath.toLowerCase().startsWith('__macos')) return
    const ext = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase()
    if (IMAGE_EXTENSIONS.has(ext)) entries.push({ path: relativePath, entry })
  })

  entries.sort((a, b) => a.path.localeCompare(b.path))
  if (entries.length === 0) {
    throw new Error('No images found in CBZ')
  }

  const pages: ArrayBuffer[] = []
  for (let i = 0; i < entries.length; i++) {
    const input = Buffer.from(await entries[i].entry.async('uint8array'))
    const pageBuffers = await convertImagePage(input, options)
    pages.push(...pageBuffers)
  }

  return buildXtcFromXtgPages(pages, {
    metadata: { toc: [] },
    is2bit: options.is2bit,
  })
}

async function convertImagePage(input: Buffer, options: ServerConversionOptions): Promise<ArrayBuffer[]> {
  const metadata = await sharp(input).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) return []

  const target = getTargetDimensions(options.device)
  const shouldSplit = options.orientation === 'landscape' && width < height && options.splitMode !== 'nosplit'
  const segments = shouldSplit ? getSegments(width, height, options.splitMode) : [{ left: 0, top: 0, width, height }]
  const rotateDegrees = options.orientation === 'landscape' ? 90 : 0

  const pages: ArrayBuffer[] = []
  for (const segment of segments) {
    let segmentInput = input
    if (segment.left !== 0 || segment.top !== 0 || segment.width !== width || segment.height !== height) {
      segmentInput = await sharp(input).extract(segment).toBuffer()
    }

    const raw = await sharp(segmentInput)
      .rotate(rotateDegrees)
      .resize({
        width: target.width,
        height: target.height,
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .ensureAlpha()
      .raw()
      .toBuffer()

    const data = new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength)
    if (options.contrast > 0) {
      applyContrastRgba(data, target.width, target.height, options.contrast)
    }
    toGrayscaleRgba(data)
    applyDitheringRgba(data, target.width, target.height, options.dithering, options.is2bit)
    pages.push(options.is2bit ? rgbaToXth(data, target.width, target.height) : rgbaToXtg(data, target.width, target.height))
  }

  return pages
}

function getTargetDimensions(device: ServerConversionOptions['device']): { width: number; height: number } {
  return device === 'X3'
    ? { width: 528, height: 792 }
    : { width: 480, height: 800 }
}

function getSegments(width: number, height: number, splitMode: ServerConversionOptions['splitMode']): Segment[] {
  if (splitMode === 'fourway') {
    const halfWidth = Math.floor(width / 2)
    const halfHeight = Math.floor(height / 2)
    return [
      { left: 0, top: 0, width: halfWidth, height: halfHeight },
      { left: 0, top: halfHeight, width: halfWidth, height: height - halfHeight },
      { left: halfWidth, top: 0, width: width - halfWidth, height: halfHeight },
      { left: halfWidth, top: halfHeight, width: width - halfWidth, height: height - halfHeight },
    ]
  }

  if (splitMode === 'split') {
    const halfHeight = Math.floor(height / 2)
    return [
      { left: 0, top: 0, width, height: halfHeight },
      { left: 0, top: halfHeight, width, height: height - halfHeight },
    ]
  }

  return getOverlapSegments(width, height)
}

function getOverlapSegments(width: number, height: number): Segment[] {
  const scale = 800 / width
  const segmentHeight = Math.floor(480 / scale)
  let numSegments = 3
  let shift = 0

  if (numSegments > 1) {
    shift = Math.floor(segmentHeight - (segmentHeight * numSegments - height) / (numSegments - 1))
  }

  while (shift / segmentHeight > 0.95 && numSegments < 10) {
    numSegments++
    shift = Math.floor(segmentHeight - (segmentHeight * numSegments - height) / (numSegments - 1))
  }

  const segments: Segment[] = []
  for (let i = 0; i < numSegments; i++) {
    segments.push({
      left: 0,
      top: Math.max(0, shift * i),
      width,
      height: i === numSegments - 1 ? height - shift * i : segmentHeight,
    })
  }
  return segments.filter((segment) => segment.width > 0 && segment.height > 0)
}
