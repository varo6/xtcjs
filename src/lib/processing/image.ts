// Image processing functions for manga optimization

interface ContentBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Convert image to grayscale using luminosity method
 */
export function toGrayscale(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Luminosity method - preserves perceived brightness
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = gray;
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Apply contrast boost to improve manga readability
 */
export function applyContrast(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  level: number
): void {
  const blackCutoff = 3 * level;
  const whiteCutoff = 3 + 9 * level;

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Build histogram
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    histogram[gray]++;
  }

  // Find cutoff points
  const totalPixels = width * height;
  const blackThreshold = totalPixels * blackCutoff / 100;
  const whiteThreshold = totalPixels * whiteCutoff / 100;

  let blackPoint = 0;
  let whitePoint = 255;
  let count = 0;

  for (let i = 0; i < 256; i++) {
    count += histogram[i];
    if (count >= blackThreshold) {
      blackPoint = i;
      break;
    }
  }

  count = 0;
  for (let i = 255; i >= 0; i--) {
    count += histogram[i];
    if (count >= whiteThreshold) {
      whitePoint = i;
      break;
    }
  }

  // Apply contrast stretch
  const range = whitePoint - blackPoint;
  if (range > 0) {
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let val = data[i + c];
        val = Math.max(0, Math.min(255, ((val - blackPoint) / range) * 255));
        data[i + c] = val;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Calculate overlapping segments for tall manga pages
 */
export function calculateOverlapSegments(
  width: number,
  height: number
): Array<{ x: number; y: number; w: number; h: number }> {
  const scale = 800 / width;
  const segmentHeight = Math.floor(480 / scale);

  let numSegments = 3;
  let shift = 0;

  if (numSegments > 1) {
    shift = Math.floor(segmentHeight - (segmentHeight * numSegments - height) / (numSegments - 1));
  }

  // Check if we need more segments (minimum 5% overlap)
  while (shift / segmentHeight > 0.95 && numSegments < 10) {
    numSegments++;
    shift = Math.floor(segmentHeight - (segmentHeight * numSegments - height) / (numSegments - 1));
  }

  const segments = [];
  for (let i = 0; i < numSegments; i++) {
    segments.push({
      x: 0,
      y: shift * i,
      w: width,
      h: i === numSegments - 1 ? height - shift * i : segmentHeight
    });
  }

  return segments;
}

type Segment = { x: number; y: number; w: number; h: number }

/**
 * Detect horizontal gutters (white strips between panel rows) in a grayscale page.
 * Scans each row for average brightness; runs of bright rows above a minimum
 * height are treated as gutters. Returns the Y center of each gutter band.
 *
 * Works without OpenCV — pure pixel scanning, browser-compatible.
 */
export function findHorizontalGutters(
  imageData: ImageData,
  whiteThreshold = 240,
  minGutterHeight = 4
): number[] {
  const { data, width, height } = imageData
  const margin = Math.floor(width * 0.05)
  const scanWidth = width - 2 * margin

  const rowBrightness = new Float32Array(height)
  for (let y = 0; y < height; y++) {
    let sum = 0
    const rowOffset = y * width * 4
    for (let x = margin; x < margin + scanWidth; x++) {
      sum += data[rowOffset + x * 4]
    }
    rowBrightness[y] = sum / scanWidth
  }

  const gutters: number[] = []
  let runStart = -1

  for (let y = 0; y < height; y++) {
    if (rowBrightness[y] >= whiteThreshold) {
      if (runStart < 0) runStart = y
    } else {
      if (runStart >= 0) {
        const runHeight = y - runStart
        if (runHeight >= minGutterHeight) {
          gutters.push(Math.floor(runStart + runHeight / 2))
        }
        runStart = -1
      }
    }
  }

  return gutters
}

/**
 * Snap overlap segment boundaries to the nearest panel gutter so segments
 * don't cut through panels. Each segment start is moved to the closest
 * gutter within 15% of the segment height. Gutters are consumed so no
 * two segments snap to the same one.
 */
export function snapSegmentsToGutters(
  segments: Segment[],
  gutters: number[],
  pageHeight: number
): Segment[] {
  if (!gutters.length || segments.length <= 1) return segments

  const segmentHeight = segments[0].h
  const threshold = segmentHeight * 0.15
  const width = segments[0].w
  const starts = segments.map(s => s.y)

  const usedGutters = new Set<number>()
  for (let i = 1; i < starts.length; i++) {
    let bestDist = threshold + 1
    let bestIdx = -1
    let bestY = starts[i]

    for (let gi = 0; gi < gutters.length; gi++) {
      if (usedGutters.has(gi)) continue
      const dist = Math.abs(gutters[gi] - starts[i])
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = gi
        bestY = gutters[gi]
      }
    }

    if (bestDist <= threshold && bestIdx >= 0) {
      usedGutters.add(bestIdx)
      starts[i] = bestY
    }
  }

  return starts.map((y, i) => ({
    x: 0,
    y,
    w: width,
    h: i === starts.length - 1 ? pageHeight - y : segmentHeight
  }))
}

/**
 * Find the tight bounds around non-white content in a grayscale image.
 */
export function findContentBounds(
  imageData: ImageData,
  whiteThreshold = 245
): ContentBounds | null {
  const { data, width, height } = imageData
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + x * 4
      if (data[pixelOffset] >= whiteThreshold) {
        continue
      }

      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (maxX < 0 || maxY < 0) {
    return null
  }

  const contentWidth = maxX - minX + 1
  const contentHeight = maxY - minY + 1
  const padX = Math.max(4, Math.floor(contentWidth * 0.04))
  const padY = Math.max(4, Math.floor(contentHeight * 0.04))
  const x = Math.max(0, minX - padX)
  const y = Math.max(0, minY - padY)
  const right = Math.min(width, maxX + padX + 1)
  const bottom = Math.min(height, maxY + padY + 1)

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  }
}

/**
 * Split a page into four reading-order quadrants for two-column layouts.
 */
export function calculateFourWaySegments(
  width: number,
  height: number
): Array<{ x: number; y: number; w: number; h: number }> {
  const halfWidth = Math.floor(width / 2)
  const rightWidth = width - halfWidth
  const halfHeight = Math.floor(height / 2)
  const bottomHeight = height - halfHeight

  return [
    { x: 0, y: 0, w: halfWidth, h: halfHeight },
    { x: 0, y: halfHeight, w: halfWidth, h: bottomHeight },
    { x: halfWidth, y: 0, w: rightWidth, h: halfHeight },
    { x: halfWidth, y: halfHeight, w: rightWidth, h: bottomHeight }
  ]
}

export function shouldSplitPage(
  width: number,
  height: number,
  orientation: 'landscape' | 'portrait',
  splitMode: 'overlap' | 'split' | 'fourway' | 'nosplit'
): boolean {
  return orientation === 'portrait'
    ? splitMode === 'fourway'
    : width < height && splitMode !== 'nosplit'
}
