const COMIC_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.jxl']

export function isComicImagePath(path: string): boolean {
  const normalized = path.toLowerCase()
  return COMIC_IMAGE_EXTENSIONS.some((extension) => normalized.endsWith(extension))
}

export function isJxlPath(path: string): boolean {
  return path.toLowerCase().endsWith('.jxl')
}

export async function decodeJxlBlob(blob: Blob): Promise<ImageData> {
  const { default: decode } = await import('@jsquash/jxl/decode.js')
  return decode(await blob.arrayBuffer())
}

export async function imageBlobToCanvas(blob: Blob, isJxl = false): Promise<HTMLCanvasElement> {
  if (isJxl) {
    const image = await decodeJxlBlob(blob)
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    canvas.getContext('2d')!.putImageData(image, 0, 0)
    return canvas
  }

  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(blob)
    image.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      canvas.getContext('2d')!.drawImage(image, 0, 0)
      resolve(canvas)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    image.src = url
  })
}
