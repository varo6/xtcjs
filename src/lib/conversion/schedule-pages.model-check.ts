/**
 * Stateless model checker for `schedulePages` driven by the real `ConvertWorkerPool`.
 *
 * Every await the scheduler makes on the outside world (`load`, a worker job,
 * a main-thread conversion) returns a promise this harness settles by hand. Each
 * run drains all microtasks, then picks one pending settlement: load finishes,
 * worker job succeeds, worker job fails, or main-thread conversion finishes. A
 * depth-first search replays the scheduler from scratch for every sequence of
 * choices, so every settlement order and every subset of failing worker jobs is
 * explored within the bounds.
 */
import { ConvertWorkerPool } from './worker-pool'
import type { schedulePages } from './schedule-pages'
import type { ConversionOptions } from './types'

export type Scheduler = typeof schedulePages

export interface Bounds {
  pages: number
  /** 0 runs without a worker pool. */
  workers: number
}

export interface Property {
  name: string
  /** Checked after every step. Returns a description of the violation, or null. */
  always?: (run: RunState) => string | null
  /** Checked once nothing is left to settle. */
  atEnd?: (run: RunState) => string | null
}

interface LoadedPage {
  index: number
}

interface ConvertedPage {
  index: number
}

type Outcome = 'resolve' | 'succeed' | 'fail'

interface PendingSettlement {
  label: (outcome: Outcome) => string
  outcomes: Outcome[]
  enabled: () => boolean
  settle: (outcome: Outcome) => void
}

export interface RunState {
  totalPages: number
  trace: string[]
  loads: number[]
  conversions: number[]
  pagesDone: number[]
  mainThreadInFlight: Set<number>
  lastOutcome: Outcome | null
  fallbackTriggered: boolean
  /** Pages first loaded after the fallback, until they are done. */
  startedAfterFallbackInFlight: Set<number>
  workers: FakeWorker[]
  pending: PendingSettlement[]
  outcome: { kind: 'running' } | { kind: 'resolved'; results: ConvertedPage[] } | { kind: 'rejected'; error: unknown }
}

let currentRun: RunState | null = null

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  terminated = false

  constructor() {
    currentRun!.workers.push(this)
  }

  postMessage(message: { jobId: number; pageNum: number }) {
    const run = currentRun!
    const pageNum = message.pageNum
    run.trace.push(`page ${pageNum} is sent to a worker`)
    run.pending.push({
      label: (outcome) => outcome === 'succeed' ? `the worker converts page ${pageNum}` : `the worker fails on page ${pageNum}`,
      outcomes: ['succeed', 'fail'],
      enabled: () => !this.terminated,
      settle: (outcome) => {
        this.onmessage!({
          data: outcome === 'succeed'
            ? { jobId: message.jobId, pages: [{ name: `page-${pageNum}`, xtg: new ArrayBuffer(0) }] }
            : { jobId: message.jobId, error: 'worker failed' }
        })
      },
    })
  }

  terminate() {
    this.terminated = true
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

const drainMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve))

function startRun(scheduler: Scheduler, { pages, workers }: Bounds): RunState {
  const run: RunState = {
    totalPages: pages,
    trace: [],
    loads: new Array(pages).fill(0),
    conversions: new Array(pages).fill(0),
    pagesDone: new Array(pages).fill(0),
    mainThreadInFlight: new Set(),
    lastOutcome: null,
    fallbackTriggered: false,
    startedAfterFallbackInFlight: new Set(),
    workers: [],
    pending: [],
    outcome: { kind: 'running' },
  }
  currentRun = run

  const pool = workers > 0 ? new ConvertWorkerPool(workers) : null
  const noOptions = {} as ConversionOptions

  scheduler<LoadedPage, ConvertedPage>({
    totalPages: pages,
    workers: pool && {
      slotCount: workers,
      convert: async ({ index }) => {
        await pool.processPage(index + 1, new Blob(), noOptions, false)
        run.conversions[index]++
        return { index }
      },
      destroy: () => {
        if (!run.fallbackTriggered && run.lastOutcome === 'fail') {
          run.fallbackTriggered = true
          run.trace.push('the pool is destroyed and conversion falls back to the main thread')
        } else {
          run.trace.push('the pool is destroyed')
        }
        pool.destroy()
      },
    },
    load: (index) => {
      run.loads[index]++
      if (run.fallbackTriggered) run.startedAfterFallbackInFlight.add(index)
      run.trace.push(`page ${index + 1} starts loading`)
      const { promise, resolve } = deferred<LoadedPage>()
      run.pending.push({
        label: () => `page ${index + 1} finishes loading`,
        outcomes: ['resolve'],
        enabled: () => true,
        settle: () => resolve({ index }),
      })
      return promise
    },
    convertOnMainThread: ({ index }) => {
      run.mainThreadInFlight.add(index)
      run.trace.push(`page ${index + 1} starts converting on the main thread`)
      const { promise, resolve } = deferred<ConvertedPage>()
      run.pending.push({
        label: () => `the main thread finishes page ${index + 1}`,
        outcomes: ['resolve'],
        enabled: () => true,
        settle: () => {
          run.mainThreadInFlight.delete(index)
          run.conversions[index]++
          resolve({ index })
        },
      })
      return promise
    },
    onPageDone: ({ index }) => {
      run.pagesDone[index]++
      run.startedAfterFallbackInFlight.delete(index)
    },
  }).then(
    (results) => { run.outcome = { kind: 'resolved', results } },
    (error) => { run.outcome = { kind: 'rejected', error } },
  )

  return run
}

export interface Violation {
  property: string
  bounds: Bounds
  message: string
  steps: string[]
}

export interface CheckReport {
  runs: number
  violation: Violation | null
}

/**
 * Explores every run of `scheduler` within `bounds` and returns the shortest
 * violation of any property, or null.
 */
export async function modelCheck(scheduler: Scheduler, bounds: Bounds, properties: Property[]): Promise<CheckReport> {
  const realWorker = globalThis.Worker
  globalThis.Worker = FakeWorker as unknown as typeof Worker
  try {
    // Each frame is one decision: which of `count` enabled settlements to apply.
    const choices: { pick: number; count: number }[] = []
    let runs = 0
    let shortest: Violation | null = null

    while (true) {
      runs++
      const violation = await replay(scheduler, bounds, properties, choices)
      if (violation && (!shortest || violation.steps.length < shortest.steps.length)) {
        shortest = violation
      }

      while (choices.length > 0 && choices[choices.length - 1].pick + 1 >= choices[choices.length - 1].count) {
        choices.pop()
      }
      if (choices.length === 0) {
        return { runs, violation: shortest }
      }
      choices[choices.length - 1].pick++
    }
  } finally {
    globalThis.Worker = realWorker
    currentRun = null
  }
}

async function replay(
  scheduler: Scheduler,
  bounds: Bounds,
  properties: Property[],
  choices: { pick: number; count: number }[]
): Promise<Violation | null> {
  const run = startRun(scheduler, bounds)
  const violated = (property: Property, message: string): Violation => ({
    property: property.name,
    bounds,
    message,
    steps: run.trace,
  })

  for (let depth = 0; ; depth++) {
    await drainMicrotasks()

    for (const property of properties) {
      const message = property.always?.(run)
      if (message) return violated(property, message)
    }

    run.pending = run.pending.filter((settlement) => settlement.enabled())
    const actions = run.pending.flatMap((settlement) => settlement.outcomes.map((outcome) => ({ settlement, outcome })))
    if (actions.length === 0) {
      for (const property of properties) {
        const message = property.atEnd?.(run)
        if (message) return violated(property, message)
      }
      return null
    }

    if (depth === choices.length) {
      choices.push({ pick: 0, count: actions.length })
    } else if (choices[depth].count !== actions.length) {
      throw new Error('Replay diverged: the harness is not deterministic')
    }

    const { settlement, outcome } = actions[choices[depth].pick]
    run.pending.splice(run.pending.indexOf(settlement), 1)
    run.trace.push(settlement.label(outcome))
    run.lastOutcome = outcome
    settlement.settle(outcome)
  }
}

export function formatViolation({ property, bounds, message, steps }: Violation): string {
  return [
    `${property} violated with ${bounds.pages} pages and ${bounds.workers} workers: ${message}`,
    ...steps.map((step, i) => `  ${i + 1}. ${step}`),
  ].join('\n')
}

const pageList = (counts: number[], predicate: (count: number) => boolean) =>
  counts.flatMap((count, index) => predicate(count) ? [`page ${index + 1}`] : []).join(', ')

export const EVERY_PAGE_ONCE_IN_ORDER: Property = {
  name: 'Every page is converted exactly once and comes out in page order',
  always: (run) => {
    const loadedTwice = pageList(run.loads, (count) => count > 1)
    if (loadedTwice) return `${loadedTwice} claimed twice`
    const convertedTwice = pageList(run.conversions, (count) => count > 1)
    if (convertedTwice) return `${convertedTwice} converted twice`
    return null
  },
  atEnd: (run) => {
    if (run.outcome.kind !== 'resolved') return null
    const missing = pageList(run.pagesDone, (count) => count !== 1)
    if (missing) return `${missing} not finished exactly once`
    const { results } = run.outcome
    if (results.length !== run.totalPages) return `${results.length} results for ${run.totalPages} pages`
    const misplaced = results.findIndex((result, index) => result?.index !== index)
    if (misplaced >= 0) return `output slot ${misplaced + 1} holds page ${results[misplaced] ? results[misplaced].index + 1 : 'nothing'}`
    return null
  },
}

export const FINISHES_AND_DESTROYS_POOL: Property = {
  name: 'Conversion always finishes and the worker pool is destroyed',
  atEnd: (run) => {
    if (run.outcome.kind === 'running') return 'nothing left to settle but schedulePages never returned'
    if (run.outcome.kind === 'rejected') return `schedulePages rejected: ${String(run.outcome.error)}`
    const alive = run.workers.filter((worker) => !worker.terminated).length
    if (alive > 0) return `${alive} workers still alive after conversion`
    return null
  },
}

export const FALLBACK_STARTS_PAGES_ONE_AT_A_TIME: Property = {
  name: 'After the fallback, new pages start on the main thread one at a time',
  always: (run) => {
    if (run.startedAfterFallbackInFlight.size <= 1) return null
    return `pages ${[...run.startedAfterFallbackInFlight].map((index) => index + 1).join(' and ')} started after the fallback and are in progress together`
  },
}

export const ONE_MAIN_THREAD_PAGE_AT_A_TIME: Property = {
  name: 'At most one page converts on the main thread at any time',
  always: (run) => {
    if (run.mainThreadInFlight.size <= 1) return null
    return `pages ${[...run.mainThreadInFlight].map((index) => index + 1).join(' and ')} convert on the main thread together`
  },
}
