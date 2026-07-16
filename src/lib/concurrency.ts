function getConcurrentTaskCount(total: number, maxConcurrency = 6): number {
  if (total <= 1) {
    return total
  }

  const cores = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4
  return Math.min(total, Math.max(2, Math.min(maxConcurrency, cores)))
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  maxConcurrency = 6
): Promise<R[]> {
  if (items.length === 0) {
    return []
  }

  const results: R[] = new Array(items.length)
  let nextIndex = 0

  const runSlot = (): Promise<void> => {
    const index = nextIndex++
    if (index >= items.length) {
      return Promise.resolve()
    }

    return mapper(items[index], index).then((result) => {
      results[index] = result
      return runSlot()
    })
  }

  await Promise.all(
    Array.from({ length: getConcurrentTaskCount(items.length, maxConcurrency) }, runSlot)
  )

  return results
}
