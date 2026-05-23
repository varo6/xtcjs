import { rgbaToXtg, rgbaToXth } from './pixels'

/**
 * Convert ImageData to XTG format (XTEink Graphics).
 */
export function imageDataToXtg(imageData: ImageData): ArrayBuffer {
  return rgbaToXtg(imageData.data, imageData.width, imageData.height)
}

export function imageDataToXth(imageData: ImageData): ArrayBuffer {
  return rgbaToXth(imageData.data, imageData.width, imageData.height)
}
