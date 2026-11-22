/**
 * The page scheduler as it was at 891445e. When a load or main-thread conversion
 * rejects, `schedulePages` rejects and destroys the pool, but the other slots
 * keep loading and converting pages on the main thread and reporting them done.
 * The model check replays that bug against this file.
 */
import type { SchedulePagesOptions } from '../schedule-pages'

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
