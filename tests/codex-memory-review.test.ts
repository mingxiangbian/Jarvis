import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import {
  getCodexPendingMemory,
  getCodexPendingReviewNotice,
  listCodexPendingMemories,
  promoteCodexPendingMemory,
  rejectCodexPendingMemory,
  reviewHashForPendingMemory
} from '../src/codex/memory-review.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { renderMemoryProjectionsFromRoot } from '../src/memory/memory-exporter.js'
import type { CyreneMemory, MemoryEvent, MemoryTombstone, PendingMemory } from '../src/memory/types.js'

const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function seedPending(cwd: string, pending: PendingMemory[]): Promise<string> {
  const identity = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(join(memoryRoot, 'pending.jsonl'), pending.map((item) => JSON.stringify(item)).join('\n') + '\n')
  return memoryRoot
}

function parseJsonLines<T>(content: string): T[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'Use Codex chat approval before promoting pending memory.',
    normalizedKey: 'codex-chat-approval-before-promote',
    evidence: [{ runId: 'run-1', summary: 'User confirmed Codex pending review workflow.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-05-25T00:00:00.000Z',
    lastSeenAt: '2026-05-25T00:00:00.000Z',
    expiresAt: '2026-06-24T00:00:00.000Z',
    tags: ['codex'],
    ...overrides
  }
}

describe('Codex pending memory review', () => {
  it('lists pending memories with review hashes and evidence summaries', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    await seedPending(cwd, [candidate])

    const result = await listCodexPendingMemories({ cwd })

    expect(result.total).toBe(1)
    expect(result.pending[0]).toMatchObject({
      id: 'pending-1',
      content: 'Use Codex chat approval before promoting pending memory.',
      evidenceSummary: ['User confirmed Codex pending review workflow.']
    })
    expect(result.pending[0]?.reviewHash).toBe(reviewHashForPendingMemory(candidate))
  })

  it('gets a pending memory by id with full candidate and review hash', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    await seedPending(cwd, [candidate])

    const result = await getCodexPendingMemory({ cwd, id: 'pending-1' })

    expect(result.result.action).toBe('get')
    if (result.result.action !== 'get') throw new Error('expected get')
    expect(result.result.candidate.content).toBe(candidate.content)
    expect(result.result.reviewHash).toBe(reviewHashForPendingMemory(candidate))
  })

  it('promotes a pending memory after hash confirmation', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await promoteCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      reason: 'User approved in Codex.',
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('promote')
    const index = await readFile(join(memoryRoot, 'index.jsonl'), 'utf8')
    expect(index).toContain(candidate.content)
    expect(index).toContain('"userConfirmed":true')
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending.trim()).toBe('')
    const events = await readFile(join(memoryRoot, 'events.jsonl'), 'utf8')
    expect(parseJsonLines<MemoryEvent>(events)).toEqual([
      expect.objectContaining({
        action: 'promote',
        candidateId: candidate.id,
        memoryId: candidate.id,
        reason: 'User approved in Codex.'
      })
    ])
    const projection = await readFile(join(memoryRoot, 'MEMORY.md'), 'utf8')
    expect(projection).toContain(candidate.content)
  })

  it('promotes affective pending memory using validator-normalized shape', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending({
      id: 'pending-affective',
      domain: 'affective',
      type: 'affective_pattern',
      strength: 'hard',
      scope: 'global',
      content: 'The user responds better when review notes stay concrete and task-focused.',
      normalizedKey: 'affective-concrete-review-notes',
      evidence: [{ runId: 'run-affect', summary: 'User explicitly preferred concrete task-focused review notes.' }],
      source: 'user_explicit',
      scores: {
        evidenceStrength: 0.95,
        stability: 0.9,
        usefulness: 0.85,
        safety: 0.95,
        sensitivity: 0.1
      }
    })
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await promoteCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      reason: 'User approved normalized affective memory.',
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('promote')
    if (result.result.action !== 'promote') throw new Error('expected promote')
    expect(result.result.memory).toMatchObject({
      id: candidate.id,
      domain: 'affective',
      strength: 'soft',
      scope: 'project',
      userConfirmed: true
    })
    const index = parseJsonLines<CyreneMemory>(await readFile(join(memoryRoot, 'index.jsonl'), 'utf8'))
    expect(index[0]).toMatchObject({
      id: candidate.id,
      strength: 'soft',
      scope: 'project',
      userConfirmed: true
    })
  })

  it('rejects a pending memory after hash confirmation and writes a tombstone', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await rejectCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      reason: 'User rejected in Codex.',
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('reject')
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending.trim()).toBe('')
    const tombstones = await readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8')
    expect(parseJsonLines<MemoryTombstone>(tombstones)).toEqual([
      expect.objectContaining({
        normalizedKey: candidate.normalizedKey,
        reason: 'rejected'
      })
    ])
    const events = await readFile(join(memoryRoot, 'events.jsonl'), 'utf8')
    expect(parseJsonLines<MemoryEvent>(events)).toEqual([
      expect.objectContaining({
        action: 'reject',
        candidateId: candidate.id,
        reason: 'User rejected in Codex.'
      })
    ])
  })

  it('returns conflict and does not mutate files when review hash is stale', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await promoteCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: 'stale',
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('conflict')
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain(candidate.content)
  })

  it('blocks promote when validator rejects the candidate', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending({
      id: 'pending-unsafe',
      normalizedKey: 'unsafe-affective-diagnostic',
      domain: 'affective',
      type: 'affective_pattern',
      content: 'The user is emotionally dependent and unstable.'
    })
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await promoteCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('rejected_by_validator')
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain(candidate.content)
  })

  it('rejects rendering projections through a symlinked memory root', async () => {
    const parent = await createTempDir('cyrene-review-root-parent-')
    const outside = await createTempDir('cyrene-review-root-outside-')
    const memoryRoot = join(parent, 'memory')
    await symlink(outside, memoryRoot)

    await expect(renderMemoryProjectionsFromRoot(memoryRoot)).rejects.toThrow(/memory symlink/)
  })

  it('rejects rendering projections through a non-directory memory root', async () => {
    const parent = await createTempDir('cyrene-review-root-parent-')
    const memoryRoot = join(parent, 'memory')
    await writeFile(memoryRoot, 'not a directory', 'utf8')

    await expect(renderMemoryProjectionsFromRoot(memoryRoot)).rejects.toThrow(/non-directory memory path/)
  })

  it('returns a compact pending review notice', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const older = createPending({ id: 'pending-old', lastSeenAt: '2026-05-25T00:00:00.000Z' })
    const newer = createPending({
      id: 'pending-new',
      content: 'Newest pending Codex memory should be visible as a notice preview.',
      normalizedKey: 'newest-pending-codex-memory',
      lastSeenAt: '2026-05-25T02:00:00.000Z'
    })
    await seedPending(cwd, [older, newer])

    const notice = await getCodexPendingReviewNotice({ cwd })

    expect(notice).toMatchObject({
      count: 2,
      hasItems: true,
      newestCandidateId: 'pending-new',
      newestPreview: 'Newest pending Codex memory should be visible as a notice preview.'
    })
  })
})
