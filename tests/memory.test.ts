import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadInstructionsIfExists } from '../src/memory.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-local-memory-'))
  tempDirs.push(dir)
  return dir
}

describe('loadInstructionsIfExists', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('returns an empty string when instructions.md does not exist', async () => {
    const root = await createTempDir()

    await expect(loadInstructionsIfExists(root)).resolves.toBe('')
  })

  it('returns titled formatted content when instructions.md exists', async () => {
    const root = await createTempDir()
    await mkdir(join(root, '.cc-local'))
    await writeFile(join(root, '.cc-local', 'instructions.md'), 'Keep changes small.\n')

    await expect(loadInstructionsIfExists(root)).resolves.toBe(
      '## Project Instructions\n\nKeep changes small.\n'
    )
  })
})
