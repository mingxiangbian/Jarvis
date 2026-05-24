import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { processMemoryCandidate } from '../src/memory/memory-lifecycle.js'
import { validateMemoryCandidate } from '../src/memory/memory-validator.js'
import { readActiveMemories, readPendingMemories, readTombstones, upsertPendingMemory } from '../src/memory/memory-store.js'
import type { MemoryDomain, MemoryStrength, MemoryType, PendingMemory } from '../src/memory/types.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-personal-memory-validator-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('personal memory validator and lifecycle', () => {
  it('auto-writes eligible project hard memory', () => {
    const decision = validateMemoryCandidate({
      candidate: createCandidate({ domain: 'project', type: 'project_fact', strength: 'hard' }),
      existingMemories: [],
      tombstones: [],
      now: '2026-05-23T00:00:00.000Z'
    })

    expect(decision.action).toBe('auto_write')
    expect(decision.action === 'auto_write' ? decision.memory.status : undefined).toBe('active')
  })

  it('keeps implicit personal memory soft or pending', () => {
    const decision = validateMemoryCandidate({
      candidate: createCandidate({
        domain: 'personal',
        type: 'interaction_style',
        strength: 'hard',
        source: 'user_implicit'
      }),
      existingMemories: [],
      tombstones: [],
      now: '2026-05-23T00:00:00.000Z'
    })

    expect(decision.action).toBe('pending')
    expect(decision.action === 'pending' ? decision.candidate.strength : undefined).toBe('soft')
  })

  it('does not auto-write procedural rules inferred only from assistant output', () => {
    const decision = validateMemoryCandidate({
      candidate: createCandidate({
        domain: 'procedural',
        type: 'procedural_rule',
        strength: 'hard',
        source: 'assistant_observed',
        content: 'Use the assistant-generated architecture framework as the default response shape.'
      }),
      existingMemories: [],
      tombstones: [],
      now: '2026-05-23T00:00:00.000Z'
    })

    expect(decision.action).toBe('pending')
  })

  it('does not auto-write candidates justified by assistant proposals without user confirmation', () => {
    const decision = validateMemoryCandidate({
      candidate: createCandidate({
        domain: 'procedural',
        type: 'procedural_rule',
        strength: 'hard',
        source: 'user_explicit',
        content: 'Use the assistant-generated eight-step architecture framework as the default response shape.',
        evidenceSummary: 'Assistant provided the framework and user accepted without correction.'
      }),
      existingMemories: [],
      tombstones: [],
      now: '2026-05-23T00:00:00.000Z'
    })

    expect(decision.action).toBe('pending')
  })

  it('keeps tentative or recent personal preferences pending', () => {
    const decision = validateMemoryCandidate({
      candidate: createCandidate({
        domain: 'personal',
        type: 'user_preference',
        strength: 'hard',
        scope: 'global',
        source: 'user_explicit',
        content: 'User prefers the assistant to first give a clear direction before expanding.',
        evidenceSummary: "User said: '我最近好像更喜欢你先给一个明确方向，不要一上来展开太多概念。'"
      }),
      existingMemories: [],
      tombstones: [],
      now: '2026-05-23T00:00:00.000Z'
    })

    expect(decision.action).toBe('pending')
    expect(decision.action === 'pending' ? decision.candidate.strength : undefined).toBe('soft')
  })

  it('keeps memory recall questions pending instead of creating duplicate rules', () => {
    const decision = validateMemoryCandidate({
      candidate: createCandidate({
        domain: 'procedural',
        type: 'procedural_rule',
        strength: 'hard',
        source: 'user_explicit',
        content: 'When user asks about architecture plans, organize the answer as conclusion, risks, then execution steps.',
        evidenceSummary: "User asked: '我之后问架构方案时，你应该怎么组织回答？'"
      }),
      existingMemories: [],
      tombstones: [],
      now: '2026-05-23T00:00:00.000Z'
    })

    expect(decision.action).toBe('pending')
  })

  it('rejects affective diagnostic claims', () => {
    const decision = validateMemoryCandidate({
      candidate: createCandidate({
        domain: 'affective',
        type: 'affective_pattern',
        strength: 'soft',
        content: 'User is anxious about architecture choices.'
      }),
      existingMemories: [],
      tombstones: [],
      now: '2026-05-23T00:00:00.000Z'
    })

    expect(decision.action).toBe('reject')
  })

  it('keeps non-diagnostic affective hard global candidates pending as soft session memory', () => {
    const decision = validateMemoryCandidate({
      candidate: createCandidate({
        domain: 'affective',
        type: 'affective_pattern',
        strength: 'hard',
        scope: 'global',
        content: 'User prefers concrete feasibility checks.'
      }),
      existingMemories: [],
      tombstones: [],
      now: '2026-05-23T00:00:00.000Z'
    })

    expect(decision.action).toBe('pending')
    expect(decision.action === 'pending' ? decision.candidate.strength : undefined).toBe('soft')
    expect(decision.action === 'pending' ? decision.candidate.scope : undefined).toBe('session')
  })

  it('requires expiresAt for session episode memory', () => {
    const candidate = createCandidate({
      domain: 'personal',
      type: 'episode',
      strength: 'session',
      scope: 'session'
    })
    const candidateWithoutExpires = { ...candidate } as Partial<PendingMemory>
    delete candidateWithoutExpires.expiresAt

    const decision = validateMemoryCandidate({
      candidate: candidateWithoutExpires as PendingMemory,
      existingMemories: [],
      tombstones: [],
      now: '2026-05-23T00:00:00.000Z'
    })

    expect(decision.action).toBe('reject')
  })

  it('normalizes episode candidates to personal session memory', () => {
    const decision = validateMemoryCandidate({
      candidate: createCandidate({
        domain: 'procedural',
        type: 'episode',
        strength: 'hard',
        scope: 'global',
        source: 'user_explicit',
        content: 'This session is testing Web-triggered memory extraction.'
      }),
      existingMemories: [],
      tombstones: [],
      now: '2026-05-23T00:00:00.000Z'
    })

    expect(decision.action).toBe('pending')
    expect(decision.action === 'pending' ? decision.candidate.domain : undefined).toBe('personal')
    expect(decision.action === 'pending' ? decision.candidate.strength : undefined).toBe('session')
    expect(decision.action === 'pending' ? decision.candidate.scope : undefined).toBe('session')
  })

  it('uses tombstones to reject repeated rejected candidates', () => {
    const decision = validateMemoryCandidate({
      candidate: createCandidate({ normalizedKey: 'rejected-key' }),
      existingMemories: [],
      tombstones: [
        {
          id: 'tombstone-1',
          normalizedKey: 'rejected-key',
          domain: 'project',
          type: 'project_fact',
          scope: 'project',
          reason: 'rejected',
          createdAt: '2026-05-23T00:00:00.000Z'
        }
      ],
      now: '2026-05-23T00:00:00.000Z'
    })

    expect(decision.action).toBe('reject')
  })

  it('promotes repeated pending candidates when policy becomes eligible', async () => {
    const cwd = await createTempDir()
    await upsertPendingMemory(cwd, createCandidate({
      id: 'pending-existing',
      domain: 'personal',
      type: 'interaction_style',
      strength: 'soft',
      normalizedKey: 'user-prefers-direct-plans'
    }))

    const result = await processMemoryCandidate({
      cwd,
      candidate: createCandidate({
        id: 'pending-new',
        domain: 'personal',
        type: 'interaction_style',
        strength: 'soft',
        normalizedKey: 'user-prefers-direct-plans',
        evidenceSummary: 'Second signal.'
      }),
      now: '2026-05-23T00:01:00.000Z'
    })

    expect(result.action).toBe('promote')
    await expect(readActiveMemories(cwd)).resolves.toHaveLength(1)
    await expect(readPendingMemories(cwd)).resolves.toEqual([])
    await expect(readTombstones(cwd)).resolves.toEqual([])
  })
})

function createCandidate(input: {
  id?: string
  domain?: MemoryDomain
  type?: MemoryType
  strength?: MemoryStrength
  scope?: 'global' | 'project' | 'session'
  source?: PendingMemory['source']
  normalizedKey?: string
  content?: string
  evidenceSummary?: string
} = {}): PendingMemory {
  return {
    id: input.id ?? 'candidate-1',
    domain: input.domain ?? 'project',
    type: input.type ?? 'project_fact',
    strength: input.strength ?? 'hard',
    scope: input.scope ?? (input.domain === 'personal' || input.domain === 'affective' ? 'global' : 'project'),
    status: 'pending',
    content: input.content ?? 'Cyrene uses typed personal memory.',
    normalizedKey: input.normalizedKey ?? 'cyrene-typed-personal-memory',
    evidence: [{ runId: input.id ?? 'run-1', summary: input.evidenceSummary ?? 'Test evidence.' }],
    source: input.source ?? 'assistant_observed',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.85,
      usefulness: 0.8,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-05-23T00:00:00.000Z',
    lastSeenAt: input.id === 'pending-new' ? '2026-05-23T00:01:00.000Z' : '2026-05-23T00:00:00.000Z',
    expiresAt: '2026-06-22T00:00:00.000Z',
    tags: []
  }
}
