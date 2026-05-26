import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  it('creates workspace plus local persona, rule, and personal memory directories', async () => {
    const root = await createTempDir()

    await execFileAsync(process.execPath, [join(process.cwd(), 'scripts/setup-local-state.mjs')], { cwd: root })

    await expect(access(join(root, 'workspace'))).resolves.toBeUndefined()
    await expect(readFile(join(root, '.cyrene', 'Soul.md'), 'utf8')).resolves.toBe('')
    await expect(readFile(join(root, '.cyrene', 'Rule.md'), 'utf8')).resolves.toBe('')
    await expect(access(join(root, '.cyrene', 'memory', 'projections'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(root, '.cyrene', 'memory', 'snapshots'))).resolves.toBeUndefined()
    await expect(readFile(join(root, '.cyrene', 'memory', 'daily.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('removes legacy workspace memory state now that memory lives at the Cyrene root', async () => {
    const root = await createTempDir()
    const legacyMemoryDir = join(root, 'workspace', '.cyrene', 'memory')
    await mkdir(legacyMemoryDir, { recursive: true })
    await writeFile(join(legacyMemoryDir, 'index.jsonl'), '{"id":"legacy-test-memory"}\n')

    await execFileAsync(process.execPath, [join(process.cwd(), 'scripts/setup-local-state.mjs')], { cwd: root })

    await expect(readFile(join(legacyMemoryDir, 'index.jsonl'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(access(join(root, '.cyrene', 'memory'))).resolves.toBeUndefined()
  })
})
