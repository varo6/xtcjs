export interface PageWorkers<Loaded, Result> {
  /** One slot per worker, each pulling pages until none are left. */
  slotCount: number
  /** Resolves null when the worker produced no pages, which sends the page to the main thread. */
  convert: (page: Loaded) => Promise<Result | null>
  /** Must reject every in-flight and queued `convert` call. */
  destroy: () => void
}

export interface SchedulePagesOptions<Loaded, Result> {
  totalPages: number
  /** Null runs a single slot on the main thread. */
  workers: PageWorkers<Loaded, Result> | null
  load: (index: number) => Promise<Loaded>
  convertOnMainThread: (page: Loaded) => Promise<Result>
  onPageDone: (result: Result) => void
}

/**
 * Converts every page, preferring the worker pool. The first worker failure
 * destroys the pool; from then on pages are converted on the main thread, one
 * at a time, so low-memory devices never run several main-thread conversions
 * at once (63552f3).
 *
 * Formally checked by `bun run verify:scheduler`; see .claude/skills/page-scheduler.
 */
export async function schedulePages<Loaded, Result>({
  totalPages,
  workers,
  load,
  convertOnMainThread,
  onPageDone,
}: SchedulePagesOptions<Loaded, Result>): Promise<Result[]> {
  const results: Result[] = new Array(totalPages)
  let pool = workers
  let nextIndex = 0
  let mainThreadTurn: Promise<unknown> = Promise.resolve()

  const convertOnMainThreadAlone = (page: Loaded): Promise<Result> => {
    const turn = mainThreadTurn.then(() => convertOnMainThread(page))
    mainThreadTurn = turn.catch(() => {})
    return turn
  }

  const runSlot = async (slotIndex: number) => {
    while (true) {
      // A null pool here means the workers failed, since slotIndex > 0 only exists with workers.
      if (!pool && slotIndex > 0) {
        return
      }

      const index = nextIndex++
      if (index >= totalPages) {
        return
      }

      const page = await load(index)
      let result: Result | null = null

      if (pool) {
        try {
          result = await pool.convert(page)
        } catch {
          if (pool) {
            pool.destroy()
            pool = null
          }
        }
      }

      if (result === null) {
        result = await convertOnMainThreadAlone(page)
      }

      results[index] = result
      onPageDone(result)
    }
  }

  try {
    await Promise.all(Array.from({ length: workers?.slotCount ?? 1 }, (_, slotIndex) => runSlot(slotIndex)))
  } finally {
    pool?.destroy()
  }

  return results
}
