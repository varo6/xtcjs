import { convertPage } from '../conversion/render-page'
import type { PageJob, PageJobResult } from '../conversion/worker-pool'

self.onmessage = async ({ data: { jobId, pageNum, image, options, includePreview } }: MessageEvent<PageJob>) => {
  let response: PageJobResult
  let transfer: Transferable[] = []
  try {
    const bitmap = image instanceof Blob ? await createImageBitmap(image) : image
    try {
      const pages = await convertPage(bitmap, pageNum, options, includePreview)
      response = { jobId, pages }
      transfer = pages.map((page) => page.xtg)
    } finally {
      bitmap.close()
    }
  } catch (err) {
    response = { jobId, error: err instanceof Error ? err.message : 'Worker processing failed' }
  }
  self.postMessage(response, { transfer })
}
