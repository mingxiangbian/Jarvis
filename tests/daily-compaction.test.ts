import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig } from '../src/config.js'
import { compactDailyIfNeeded } from '../src/daily-compaction.js'
import type { CallModelInput, ModelResponse } from '../src/llm-client.js'
import type { CompactMemoriesInput, CompactMemoriesResult } from '../src/memory.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-local-daily-compaction-'))
  tempDirs.push(dir)
  return dir
}

async function writeDaily(cwd: string, content: string): Promise<string> {
  const memoryDir = join(cwd, '.cc-local', 'memory')
  await mkdir(memoryDir, { recursive: true })
  const dailyPath = join(memoryDir, 'daily.md')
  await writeFile(dailyPath, content)
  return dailyPath
}

describe('compactDailyIfNeeded', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('skips below threshold and leaves daily.md unchanged', async () => {
    const root = await createTempDir()
    const dailyPath = await writeDaily(root, 'one\n\n')
    const config = { ...createDefaultConfig(root), dailyCompactThreshold: 2 }
    const compactMemories = vi.fn(async (_input: CompactMemoriesInput): Promise<CompactMemoriesResult> => ({
      ok: true,
      promoted: 1
    }))

    await compactDailyIfNeeded({ cwd: root, config, compactMemories })

    expect(compactMemories).not.toHaveBeenCalled()
    await expect(readFile(dailyPath, 'utf8')).resolves.toBe('one\n\n')
  })

  it('does not throw or compact when daily memory cannot be loaded', async () => {
    const root = await createTempDir()
    const missingRoot = join(root, 'missing')
    const config = { ...createDefaultConfig(missingRoot), dailyCompactThreshold: 1 }
    const compactMemories = vi.fn(async (_input: CompactMemoriesInput): Promise<CompactMemoriesResult> => ({
      ok: true,
      promoted: 1
    }))

    await expect(compactDailyIfNeeded({ cwd: missingRoot, config, compactMemories })).resolves.toBeUndefined()

    expect(compactMemories).not.toHaveBeenCalled()
  })

  it('runs at threshold with raw daily content', async () => {
    const root = await createTempDir()
    const dailyContent = 'one\n\ntwo\n'
    await writeDaily(root, dailyContent)
    const config = { ...createDefaultConfig(root), dailyCompactThreshold: 2 }
    const callModel = vi.fn(
      async (_input: CallModelInput): Promise<ModelResponse> => ({ content: 'unused', toolCalls: [] })
    )
    const compactMemories = vi.fn(async (_input: CompactMemoriesInput): Promise<CompactMemoriesResult> => ({
      ok: true,
      promoted: 1
    }))

    await compactDailyIfNeeded({ cwd: root, config, callModel, compactMemories })

    expect(compactMemories).toHaveBeenCalledWith({
      cwd: root,
      dailyContent,
      config,
      callModel
    })
  })

  it('does not throw when compaction returns ok false and leaves daily.md unchanged', async () => {
    const root = await createTempDir()
    const dailyPath = await writeDaily(root, 'one\ntwo\n')
    const config = { ...createDefaultConfig(root), dailyCompactThreshold: 2 }
    const compactMemories = vi.fn(async (_input: CompactMemoriesInput): Promise<CompactMemoriesResult> => ({
      ok: false,
      error: 'bad json'
    }))

    await expect(compactDailyIfNeeded({ cwd: root, config, compactMemories })).resolves.toBeUndefined()
    await expect(readFile(dailyPath, 'utf8')).resolves.toBe('one\ntwo\n')
  })

  it('does not throw when compaction throws and leaves daily.md unchanged', async () => {
    const root = await createTempDir()
    const dailyPath = await writeDaily(root, 'one\ntwo\n')
    const config = { ...createDefaultConfig(root), dailyCompactThreshold: 2 }
    const compactMemories = vi.fn(async (_input: CompactMemoriesInput): Promise<CompactMemoriesResult> => {
      throw new Error('network failed')
    })

    await expect(compactDailyIfNeeded({ cwd: root, config, compactMemories })).resolves.toBeUndefined()
    await expect(readFile(dailyPath, 'utf8')).resolves.toBe('one\ntwo\n')
  })
})
