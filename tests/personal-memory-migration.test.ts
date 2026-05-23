import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyMemory } from '../src/memory/memory-migration.js'
import { createMemorySnapshot, listMemorySnapshots, restoreMemorySnapshot } from '../src/memory/memory-snapshot.js'
import { readActiveMemories, writeActiveMemories } from '../src/memory/memory-store.js'
import type { CyreneMemory } from '../src/memory/types.js'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-personal-memory-migration-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('personal memory migration and snapshots', () => {
  it('migrates legacy markdown, daily, and session memory into the typed store and removes legacy files', async () => {
    const cwd = await createTempDir()
    const memoryDir = join(cwd, '.cyrene', 'memory')
    await mkdir(join(memoryDir, 'sessions'), { recursive: true })
    await writeFile(join(memoryDir, 'MEMORY.md'), '- [Code Style](style.md) — [project] Prefer small patches\n')
    await writeFile(join(memoryDir, 'style.md'), 'Prefer small patches.\n')
    await writeFile(join(memoryDir, 'daily.md'), 'recent daily fact\n')
    await writeFile(join(memoryDir, 'sessions', '2026-05-22.md'), 'previous session summary\n')

    const result = await migrateLegacyMemory(cwd)

    expect(result).toMatchObject({ migrated: 3, deletedLegacyFiles: 3 })
    expect(result.snapshotId).toMatch(/^memory-/)
    const memories = await readActiveMemories(cwd)
    expect(memories.map((memory) => [memory.domain, memory.type, memory.strength, memory.scope, memory.content])).toEqual(
      expect.arrayContaining([
        ['project', 'project_fact', 'hard', 'project', 'Prefer small patches.'],
        ['personal', 'episode', 'session', 'session', 'recent daily fact'],
        ['personal', 'episode', 'session', 'session', 'previous session summary']
      ])
    )
    await expect(readFile(join(memoryDir, 'style.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryDir, 'daily.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryDir, 'sessions', '2026-05-22.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryDir, 'MEMORY.md'), 'utf8')).resolves.toContain(
      'Generated from .cyrene/memory/index.jsonl'
    )
  })

  it('creates snapshots, supports dry-run restore, and restores typed memory state', async () => {
    const cwd = await createTempDir()
    await writeActiveMemories(cwd, [createActiveMemory({ id: 'mem-before', content: 'Before snapshot.' })])
    const snapshot = await createMemorySnapshot(cwd, 'before change')

    await writeActiveMemories(cwd, [createActiveMemory({ id: 'mem-after', content: 'After snapshot.' })])
    const dryRun = await restoreMemorySnapshot({ cwd, snapshotId: snapshot.id, dryRun: true })

    expect(dryRun).toMatchObject({ restored: false, activeCount: 1 })
    await expect(readActiveMemories(cwd)).resolves.toMatchObject([{ id: 'mem-after' }])

    const restored = await restoreMemorySnapshot({ cwd, snapshotId: snapshot.id })

    expect(restored).toMatchObject({ restored: true, activeCount: 1 })
    await expect(readActiveMemories(cwd)).resolves.toMatchObject([{ id: 'mem-before' }])
    await expect(listMemorySnapshots(cwd)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: snapshot.id, reason: 'before change' })])
    )
  })

  it('prints typed memory from the CLI', async () => {
    const cwd = await createTempDir()
    await writeActiveMemories(cwd, [createActiveMemory({ id: 'mem-cli', content: 'CLI can list typed memory.' })])

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', cwd, 'memory', 'list'],
      { env: cliEnv() }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('mem-cli')
    expect(result.stdout).toContain('CLI can list typed memory.')
  })
})

function createActiveMemory(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'mem-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Cyrene uses typed memory.',
    normalizedKey: 'cyrene-typed-memory',
    evidence: [{ runId: 'run-1', summary: 'Test evidence.' }],
    source: 'assistant_observed',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.8,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    tags: [],
    ...overrides
  }
}

function cliEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const { FORCE_COLOR: _forceColor, NO_COLOR: _noColor, ...env } = process.env
  return { ...env, ...overrides }
}
