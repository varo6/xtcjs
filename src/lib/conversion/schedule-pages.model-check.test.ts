import { afterAll, describe, expect, test } from 'bun:test'
import { schedulePages } from './schedule-pages'
import { schedulePages as schedulePagesBefore63552f3 } from './fixtures/schedule-pages-before-63552f3'
import { schedulePages as schedulePagesAt891445e } from './fixtures/schedule-pages-at-891445e'
import {
  EVERY_PAGE_ONCE_IN_ORDER,
  FALLBACK_STARTS_PAGES_ONE_AT_A_TIME,
  FINISHES_AND_DESTROYS_POOL,
  NOTHING_STARTS_AFTER_SETTLE,
  ONE_MAIN_THREAD_PAGE_AT_A_TIME,
  formatViolation,
  modelCheck,
  type Bounds,
} from './schedule-pages.model-check'

const PROPERTIES = [
  EVERY_PAGE_ONCE_IN_ORDER,
  FINISHES_AND_DESTROYS_POOL,
  FALLBACK_STARTS_PAGES_ONE_AT_A_TIME,
  ONE_MAIN_THREAD_PAGE_AT_A_TIME,
  NOTHING_STARTS_AFTER_SETTLE,
]

const BOUNDS: Bounds[] = [
  ...[1, 2, 3, 4, 5].flatMap((pages) => [0, 1, 2, 3].map((workers) => ({ pages, workers }))),
  { pages: 6, workers: 2 },
]

describe('schedulePages holds every property in every interleaving', () => {
  let totalRuns = 0
  afterAll(() => console.log(`schedulePages: ${totalRuns} interleavings explored across ${BOUNDS.length} bounds`))

  for (const bounds of BOUNDS) {
    test(`${bounds.pages} pages, ${bounds.workers} workers, ${bounds.rejections ?? 0} rejections`, async () => {
      const { runs, violation } = await modelCheck(schedulePages, bounds, PROPERTIES)
      totalRuns += runs
      if (violation) throw new Error(formatViolation(violation))
    }, 30_000)
  }
})

test('replays 63552f3: before the fix, every slot kept starting pages on the main thread after the fallback', async () => {
  const { violation } = await modelCheck(schedulePagesBefore63552f3, { pages: 4, workers: 2 }, [FALLBACK_STARTS_PAGES_ONE_AT_A_TIME])

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

test('replays 891445e: a rejected load let the other slots keep converting pages after schedulePages rejected', async () => {
  const { violation } = await modelCheck(schedulePagesAt891445e, { pages: 2, workers: 2, rejections: 1 }, [NOTHING_STARTS_AFTER_SETTLE])

  expect(violation && formatViolation(violation)).toBe([
    'Once schedulePages settles, nothing new starts and the worker pool is destroyed violated with 2 pages and 2 workers: after schedulePages settled: page 2 is handed to the worker pool, page 2 starts converting on the main thread',
    '  1. page 1 starts loading',
    '  2. page 2 starts loading',
    '  3. page 1 fails to load',
    '  4. the pool is destroyed',
    '  5. schedulePages rejects: Error: page 1 failed to load',
    '  6. page 2 finishes loading',
    '  7. the pool is destroyed',
    '  8. page 2 starts converting on the main thread',
  ].join('\n'))
})
