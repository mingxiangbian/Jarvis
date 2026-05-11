import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/config.js'
import { fileReadTool } from '../src/tools/file-read.js'

describe('fileReadTool', () => {
  const tempRoots: string[] = []

  async function createTempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'file-read-test-'))
    tempRoots.push(root)
    return root
  }

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('returns numbered lines and tracks the real file path', async () => {
    const root = await createTempRoot()
    const file = join(root, 'note.txt')
    await writeFile(file, 'alpha\nbeta\n', 'utf8')

    const trackedFiles = new Set<string>()
    const canonicalFile = await realpath(file)
    const result = await fileReadTool.execute(
      { file_path: file },
      { config: createDefaultConfig(root), trackedFiles }
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('1 | alpha')
    expect(result.content).toContain('2 | beta')
    expect([...trackedFiles]).toContain(canonicalFile)
  })

  it('returns a helpful failure when the file does not exist', async () => {
    const root = await createTempRoot()

    const result = await fileReadTool.execute(
      { file_path: join(root, 'missing.txt') },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('Unable to read file')
  })

  it('preserves original line numbers when compacting long files', async () => {
    const root = await createTempRoot()
    const file = join(root, 'long.txt')
    const lines = Array.from({ length: 160 }, (_, index) => `line ${index + 1}`)
    await writeFile(file, lines.join('\n'), 'utf8')

    const result = await fileReadTool.execute(
      { file_path: file },
      { config: { ...createDefaultConfig(root), readMaxInlineLines: 5 }, trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(true)
    expect(result.metadata?.compacted).toBe(true)
    expect(result.content).toContain('1 | line 1')
    expect(result.content).toContain('160 | line 160')
    expect(result.content).toContain('[output compacted]')
  })
})
