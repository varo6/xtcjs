export class TaskQueueFullError extends Error {}

export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve()
  private pending = 0

  constructor(private readonly maxPending = 4) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.pending >= this.maxPending) {
      return Promise.reject(new TaskQueueFullError('Too many pending conversions'))
    }

    this.pending++
    const result = this.tail.then(task, task)
    this.tail = result.then(() => undefined, () => undefined)
    return result.finally(() => this.pending--)
  }
}
