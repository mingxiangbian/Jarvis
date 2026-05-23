import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-setup-'))
  tempDirs.push(dir)
  return dir
}

describe('setup-local-state', () => {
  it('creates workspace plus local persona, rule, and daily memory files', async () => {
    const root = await createTempDir()

    await execFileAsync(process.execPath, [join(process.cwd(), 'scripts/setup-local-state.mjs')], { cwd: root })

    await expect(access(join(root, 'workspace'))).resolves.toBeUndefined()
    await expect(readFile(join(root, '.cyrene', 'Soul.md'), 'utf8')).resolves.toBe('')
    await expect(readFile(join(root, '.cyrene', 'Rule.md'), 'utf8')).resolves.toBe('')
    await expect(readFile(join(root, '.cyrene', 'memory', 'daily.md'), 'utf8')).resolves.toBe('')
  })
})
