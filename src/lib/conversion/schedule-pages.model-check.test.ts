import { afterAll, describe, expect, test } from 'bun:test'
import { schedulePages } from './schedule-pages'
import { schedulePages as schedulePagesBefore63552f3 } from './fixtures/schedule-pages-before-63552f3'
import {
  EVERY_PAGE_ONCE_IN_ORDER,
  FALLBACK_STARTS_PAGES_ONE_AT_A_TIME,
  FINISHES_AND_DESTROYS_POOL,
  ONE_MAIN_THREAD_PAGE_AT_A_TIME,
  formatViolation,
  modelCheck,
  type Bounds,
} from './schedule-pages.model-check'

const PROPERTIES = [EVERY_PAGE_ONCE_IN_ORDER, FINISHES_AND_DESTROYS_POOL, FALLBACK_STARTS_PAGES_ONE_AT_A_TIME]

const BOUNDS: Bounds[] = [
  ...[1, 2, 3, 4, 5].flatMap((pages) => [0, 1, 2, 3].map((workers) => ({ pages, workers }))),
  { pages: 6, workers: 2 },
]

describe('schedulePages holds every property in every interleaving', () => {
  let totalRuns = 0
  afterAll(() => console.log(`schedulePages: ${totalRuns} interleavings explored across ${BOUNDS.length} bounds`))

  for (const bounds of BOUNDS) {
    test(`${bounds.pages} pages, ${bounds.workers} workers`, async () => {
      const { runs, violation } = await modelCheck(schedulePages, bounds, PROPERTIES)
      totalRuns += runs
      if (violation) throw new Error(formatViolation(violation))
    }, 30_000)
  }
})

test('replays 63552f3: before the fix, every slot kept starting pages on the main thread after the fallback', async () => {
  const { violation } = await modelCheck(schedulePagesBefore63552f3, { pages: 4, workers: 2 }, PROPERTIES)

  expect(violation && formatViolation(violation)).toBe([
    'After the fallback, new pages start on the main thread one at a time violated with 4 pages and 2 workers: pages 3 and 4 started after the fallback and are in progress together',
    '  1. page 1 starts loading',
    '  2. page 2 starts loading',
    '  3. page 1 finishes loading',
    '  4. page 1 is sent to a worker',
    '  5. the worker fails on page 1',
    '  6. the pool is destroyed and conversion falls back to the main thread',
    '  7. page 1 starts converting on the main thread',
    '  8. page 2 finishes loading',
    '  9. page 2 starts converting on the main thread',
    '  10. the main thread finishes page 1',
    '  11. page 3 starts loading',
    '  12. the main thread finishes page 2',
    '  13. page 4 starts loading',
  ].join('\n'))
})

// Known finding, kept failing on purpose: the fallback sends every page already
// claimed by another slot to the main thread at once. When the code is fixed,
// this test fails; move ONE_MAIN_THREAD_PAGE_AT_A_TIME into PROPERTIES.
test('FINDING: pages already claimed when the fallback triggers all convert on the main thread together', async () => {
  const { violation } = await modelCheck(schedulePages, { pages: 2, workers: 2 }, [ONE_MAIN_THREAD_PAGE_AT_A_TIME])

  expect(violation && formatViolation(violation)).toBe([
    'At most one page converts on the main thread at any time violated with 2 pages and 2 workers: pages 1 and 2 convert on the main thread together',
    '  1. page 1 starts loading',
    '  2. page 2 starts loading',
    '  3. page 1 finishes loading',
    '  4. page 1 is sent to a worker',
    '  5. the worker fails on page 1',
    '  6. the pool is destroyed and conversion falls back to the main thread',
    '  7. page 1 starts converting on the main thread',
    '  8. page 2 finishes loading',
    '  9. page 2 starts converting on the main thread',
  ].join('\n'))
})
