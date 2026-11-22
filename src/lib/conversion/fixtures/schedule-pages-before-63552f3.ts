/**
 * The page scheduler as it was at 63552f3^ (src/lib/converter.ts
 * processArchiveSourcePages), ported to the `schedulePages` signature. It lacks
 * the slot > 0 exit, so after a worker failure every slot keeps starting pages
 * on the main thread. The model check replays that bug against this file.
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

  const runSlot = async () => {
    while (true) {
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
        result = await convertOnMainThread(page)
      }

      results[index] = result
      onPageDone(result)
    }
  }

  try {
    await Promise.all(Array.from({ length: workers?.slotCount ?? 1 }, () => runSlot()))
  } finally {
    pool?.destroy()
  }

  return results
}
