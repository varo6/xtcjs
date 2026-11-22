// Page-side entry for the e2e tests. It only wires the app's public modules to
// `window.xtcHarness`; all assertions live in the tests.
import { convertToXtc, type ConversionOptions } from '../../src/lib/converter'
import { getTargetDimensions } from '../../src/lib/processing/canvas'

export type SourceType = 'cbz' | 'pdf' | 'image'
export type Pipeline = 'worker' | 'main-thread'

const NativeWorker = window.Worker
const NativeOffscreenCanvas = window.OffscreenCanvas
let workersCreated = 0
window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options)
    workersCreated++
  }
}

async function convert(
  bytes: Uint8Array,
  name: string,
  type: SourceType,
  options: ConversionOptions,
  pipeline: Pipeline,
) {
  const file = new File([new Uint8Array(bytes)], name)
  const workersBefore = workersCreated
  // Without OffscreenCanvas the converter takes its main-thread fallback.
  Object.defineProperty(window, 'OffscreenCanvas', {
    value: pipeline === 'worker' ? NativeOffscreenCanvas : undefined,
    configurable: true,
  })
  try {
    const result = await convertToXtc(file, type, options, () => {})
    return {
      data: new Uint8Array(result.data!),
      pageCount: result.pageCount!,
      workersCreated: workersCreated - workersBefore,
    }
  } finally {
    Object.defineProperty(window, 'OffscreenCanvas', { value: NativeOffscreenCanvas, configurable: true })
  }
}

const xtcHarness = { convert, targetDimensions: getTargetDimensions }
export type Harness = typeof xtcHarness
;(window as unknown as { xtcHarness: Harness }).xtcHarness = xtcHarness
