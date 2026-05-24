import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function ensureParentDirectory(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
}
