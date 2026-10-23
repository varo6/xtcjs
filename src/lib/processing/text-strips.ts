type Strip = { x: number; y: number; w: number; h: number }

/** Expand crop edges into nearby row gaps without losing any original content. */
export function alignStripBoundaries(
  image: Pick<ImageData, 'width' | 'height' | 'data'>,
  strips: readonly Strip[],
): Strip[] {
  const { width, height, data } = image
  const histogram = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) histogram[data[i]]++
  let background = 0
  let pixels = 0
  while (background < 255) {
    pixels += histogram[background]
    if (pixels >= width * height * 0.8) break
    background++
  }
  // Estimate paper brightness so grey scans do not look like solid ink.
  const threshold = Math.max(1, background - 24)
  const inkRows = new Uint8Array(height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4] < threshold) {
        inkRows[y] = 1
        break
      }
    }
  }

  // Require a small gap on both sides to keep dots and accents with their line.
  const padding = Math.max(2, Math.min(4, Math.round(height / 900)))
  const isGap = (y: number) => {
    if (y === 0 || y === height) return true
    for (let row = Math.max(0, y - padding); row < Math.min(height, y + padding); row++) {
      if (inkRows[row]) return false
    }
    return true
  }
  const findEdge = (edge: number, direction: number, distance: number) => {
    for (let delta = 0; delta <= distance; delta++) {
      const candidate = edge + direction * delta
      if (candidate < 0 || candidate > height) break
      if (isGap(candidate)) return candidate
    }
    return edge
  }

  return strips.map(strip => {
    const distance = Math.max(8, Math.min(48, Math.round(strip.h * 0.04)))
    const top = findEdge(strip.y, -1, distance)
    const bottom = findEdge(strip.y + strip.h, 1, distance)
    return { ...strip, y: top, h: bottom - top }
  })
}
