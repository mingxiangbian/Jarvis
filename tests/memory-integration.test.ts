import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadInstructionsIfExists,
  loadMemories,
  loadRecentSummaries,
  saveSessionSummary,
  updateMemoryIndex
} from '../src/memory.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-memory-int-'))
  tempDirs.push(dir)
  return dir
}

describe('memory system end-to-end', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('loads a memory file after it is written and indexed', async () => {
    const root = await createTempDir()
    const memoryDir = join(root, '.jarvis', 'memory')
    await mkdir(memoryDir, { recursive: true })
    await writeFile(join(memoryDir, 'style.md'), 'Use single quotes\n')

    await updateMemoryIndex(root, {
      title: 'Code Style',
      file: 'style.md',
      summary: 'use single quotes'
    })

    const memories = await loadMemories(root)
    expect(memories).toContain('## Memory: Code Style')
    expect(memories).toContain('Use single quotes')
  })

  it('loads recently saved session summaries', async () => {
    const root = await createTempDir()

    await saveSessionSummary(
      root,
      '## Intent\nFixed a bug\n\n## Decisions Made\n- Option A\n\n## Files Modified\n- file.ts\n\n## Test Results\nPassed\n\n## Pending\n- None'
    )
    await saveSessionSummary(
      root,
      '## Intent\nAdded feature\n\n## Decisions Made\n- Option B\n\n## Files Modified\n- feature.ts\n\n## Test Results\nPassed\n\n## Pending\n- Docs'
    )

    const summaries = await loadRecentSummaries(root, 2)
    expect(summaries).toContain('Fixed a bug')
    expect(summaries).toContain('Added feature')

    const sessionsDir = join(root, '.jarvis', 'memory', 'sessions')
    const files = await readdir(sessionsDir)
    expect(files).toHaveLength(2)
  })

  it('degrades gracefully with no .jarvis directory', async () => {
    const root = await createTempDir()

    await expect(loadMemories(root)).resolves.toBe('')
    await expect(loadRecentSummaries(root, 3)).resolves.toBe('')
    await expect(loadInstructionsIfExists(root)).resolves.toBe('')
  })
})
