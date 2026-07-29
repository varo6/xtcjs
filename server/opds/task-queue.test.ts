import { expect, test } from 'bun:test'
import { SerialTaskQueue, TaskQueueFullError } from './task-queue'

test('runs expensive conversions one at a time', async () => {
  const queue = new SerialTaskQueue()
  let active = 0
  let maxActive = 0

  const task = () => queue.run(async () => {
    active++
    maxActive = Math.max(maxActive, active)
    await Bun.sleep(10)
    active--
  })

  await Promise.all([task(), task(), task()])

  expect(maxActive).toBe(1)
})

test('continues after a failed conversion', async () => {
  const queue = new SerialTaskQueue()

  await expect(queue.run(async () => { throw new Error('failed') })).rejects.toThrow('failed')
  expect(await queue.run(async () => 'next')).toBe('next')
})

test('rejects work when the pending conversion limit is reached', async () => {
  const queue = new SerialTaskQueue(1)
  let release!: () => void
  const blocked = queue.run(() => new Promise<void>((resolve) => { release = resolve }))

  await expect(queue.run(async () => undefined)).rejects.toBeInstanceOf(TaskQueueFullError)
  release()
  await blocked
})
