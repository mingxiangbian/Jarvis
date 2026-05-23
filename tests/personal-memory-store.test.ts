import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendMemoryEvent,
  readActiveMemories,
  readMemoryEvents,
  readPendingMemories,
  upsertPendingMemory,
  writeActiveMemories
} from '../src/memory/memory-store.js'
import type { CyreneMemory, PendingMemory } from '../src/memory/types.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-personal-memory-store-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('personal memory store', () => {
  it('writes and reads active memories from index.jsonl', async () => {
    const cwd = await createTempDir()
    const memory = createActiveMemory({ id: 'mem-1', content: 'Cyrene uses typed personal memory.' })

    await writeActiveMemories(cwd, [memory])

    await expect(readActiveMemories(cwd)).resolves.toEqual([memory])
    await expect(readFile(join(cwd, '.cyrene', 'memory', 'index.jsonl'), 'utf8')).resolves.toContain('"id":"mem-1"')
  })

  it('merges pending candidates by normalizedKey', async () => {
    const cwd = await createTempDir()
    const first = createPendingMemory({
      id: 'pending-1',
      normalizedKey: 'user-prefers-direct-plans',
      evidenceSummary: 'First signal.',
      evidenceStrength: 0.6
    })
    const second = createPendingMemory({
      id: 'pending-2',
      normalizedKey: 'user-prefers-direct-plans',
      evidenceSummary: 'Second signal.',
      evidenceStrength: 0.8
    })

    await upsertPendingMemory(cwd, first)
    const merged = await upsertPendingMemory(cwd, second)

    expect(merged.id).toBe('pending-1')
    expect(merged.seenCount).toBe(2)
    expect(merged.lastSeenAt).toBe(second.lastSeenAt)
    expect(merged.evidence.map((entry) => entry.summary)).toEqual(['First signal.', 'Second signal.'])
    expect(merged.scores.evidenceStrength).toBeCloseTo(0.7)
    await expect(readPendingMemories(cwd)).resolves.toEqual([merged])
  })

  it('appends lifecycle events', async () => {
    const cwd = await createTempDir()

    await appendMemoryEvent(cwd, {
      id: 'event-1',
      action: 'create',
      at: '2026-05-23T00:00:00.000Z',
      reason: 'test event',
      memoryId: 'mem-1'
    })

    await expect(readMemoryEvents(cwd)).resolves.toEqual([
      {
        id: 'event-1',
        action: 'create',
        at: '2026-05-23T00:00:00.000Z',
        reason: 'test event',
        memoryId: 'mem-1'
      }
    ])
  })

  it('refuses to write through a symlinked memory directory', async () => {
    const cwd = await createTempDir()
    const outside = await createTempDir()
    await mkdir(join(cwd, '.cyrene'), { recursive: true })
    await mkdir(join(outside, 'memory'), { recursive: true })
    await symlink(join(outside, 'memory'), join(cwd, '.cyrene', 'memory'))

    await expect(writeActiveMemories(cwd, [createActiveMemory({ id: 'mem-1' })])).rejects.toThrow(
      /Refusing to use memory symlink/
    )
    await expect(readFile(join(outside, 'memory', 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
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

function createPendingMemory(input: {
  id: string
  normalizedKey: string
  evidenceSummary: string
  evidenceStrength: number
}): PendingMemory {
  return {
    id: input.id,
    domain: 'personal',
    type: 'interaction_style',
    strength: 'soft',
    scope: 'global',
    status: 'pending',
    content: 'User prefers direct implementation plans.',
    normalizedKey: input.normalizedKey,
    evidence: [{ runId: input.id, summary: input.evidenceSummary }],
    source: 'user_implicit',
    scores: {
      evidenceStrength: input.evidenceStrength,
      stability: 0.7,
      usefulness: 0.8,
      safety: 0.9,
      sensitivity: 0.2
    },
    seenCount: 1,
    firstSeenAt: '2026-05-23T00:00:00.000Z',
    lastSeenAt: input.id === 'pending-1' ? '2026-05-23T00:00:00.000Z' : '2026-05-23T00:01:00.000Z',
    expiresAt: '2026-06-22T00:00:00.000Z',
    tags: []
  }
}
