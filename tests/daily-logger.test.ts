import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendDaily } from '../src/daily-logger.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-daily-'))
  tempDirs.push(dir)
  return dir
}

describe('appendDaily', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('creates memory directory and appends daily chunks without overwriting', async () => {
    const root = await createTempDir()

    await appendDaily(root, ['[09:08] bash -> ok exit 0'])
    await appendDaily(root, ['[09:09] file_read -> ok src/config.ts'])

    await expect(readFile(join(root, '.jarvis', 'memory', 'daily.md'), 'utf8')).resolves.toBe(
      '[09:08] bash -> ok exit 0\n[09:09] file_read -> ok src/config.ts\n'
    )
  })

  it('does nothing for empty chunks', async () => {
    const root = await createTempDir()

    await appendDaily(root, [])

    await expect(readFile(join(root, '.jarvis', 'memory', 'daily.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('refuses to append through a symlinked daily file', async () => {
    const root = await createTempDir()
    const outside = await createTempDir()
    const memoryDir = join(root, '.jarvis', 'memory')
    await mkdir(memoryDir, { recursive: true })
    await writeFile(join(outside, 'daily.md'), 'outside\n')
    await symlink(join(outside, 'daily.md'), join(memoryDir, 'daily.md'))

    await expect(appendDaily(root, ['[09:08] bash -> ok'])).rejects.toThrow(/symlink|ELOOP/)
    await expect(readFile(join(outside, 'daily.md'), 'utf8')).resolves.toBe('outside\n')
  })

  it('refuses to append through a symlinked .jarvis directory', async () => {
    const root = await createTempDir()
    const outsideJarvis = await createTempDir()
    await symlink(outsideJarvis, join(root, '.jarvis'))

    await expect(appendDaily(root, ['[09:08] bash -> ok'])).rejects.toThrow(/symlink/)
    await expect(readFile(join(outsideJarvis, 'memory', 'daily.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
