import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renderMemoryProjections } from '../src/memory/memory-exporter.js'
import { formatMemoryContext, retrieveMemories } from '../src/memory/memory-retriever.js'
import { writeActiveMemories } from '../src/memory/memory-store.js'
import type { CyreneMemory, MemoryDomain, MemoryStrength, MemoryType } from '../src/memory/types.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-personal-memory-retriever-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('personal memory projections and retrieval', () => {
  it('renders projections from active low-sensitivity memories only', async () => {
    const cwd = await createTempDir()
    await writeActiveMemories(cwd, [
      createMemory({
        id: 'project-1',
        domain: 'project',
        type: 'project_fact',
        strength: 'hard',
        content: 'Cyrene uses API-first routing.'
      }),
      createMemory({
        id: 'personal-1',
        domain: 'personal',
        type: 'interaction_style',
        strength: 'soft',
        content: 'User prefers direct engineering recommendations.'
      })
    ])

    await renderMemoryProjections(cwd)

    await expect(readFile(join(cwd, '.cyrene', 'memory', 'projections', 'MEMORY.md'), 'utf8')).resolves.toContain(
      'User prefers direct engineering recommendations.'
    )
    await expect(readFile(join(cwd, '.cyrene', 'memory', 'projections', 'PROJECT.md'), 'utf8')).resolves.toContain(
      'Cyrene uses API-first routing.'
    )
    await expect(readFile(join(cwd, '.cyrene', 'memory', 'MEMORY.md'), 'utf8')).resolves.toContain(
      'Generated from .cyrene/memory/index.jsonl'
    )
  })

  it('redacts affective projection output', async () => {
    const cwd = await createTempDir()
    await writeActiveMemories(cwd, [
      createMemory({
        id: 'affect-safe',
        domain: 'affective',
        type: 'affective_pattern',
        strength: 'soft',
        content: 'User prefers concrete feasibility checks when discussing local model constraints.',
        safety: 0.95,
        sensitivity: 0.2
      }),
      createMemory({
        id: 'affect-sensitive',
        domain: 'affective',
        type: 'affective_pattern',
        strength: 'soft',
        content: 'User is anxious about architecture choices.',
        safety: 0.7,
        sensitivity: 0.8
      })
    ])

    await renderMemoryProjections(cwd)

    const affect = await readFile(join(cwd, '.cyrene', 'memory', 'projections', 'AFFECT.md'), 'utf8')
    expect(affect).toContain('concrete feasibility checks')
    expect(affect).not.toContain('anxious')
  })

  it('retrieves coding memories from project procedural and system domains', async () => {
    const cwd = await createTempDir()
    await writeActiveMemories(cwd, [
      createMemory({ id: 'project-1', domain: 'project', type: 'project_fact', content: 'Provider router owns model routing.' }),
      createMemory({ id: 'procedural-1', domain: 'procedural', type: 'procedural_rule', content: 'Keep provider-specific fields inside adapters.' }),
      createMemory({ id: 'personal-1', domain: 'personal', type: 'interaction_style', content: 'User prefers terse answers.' })
    ])

    const memories = await retrieveMemories({
      cwd,
      userCyreneDir: join(cwd, '.cyrene'),
      query: 'provider router adapter',
      task: 'coding',
      maxItems: 10,
      maxTokens: 500
    })

    expect(memories.map((memory) => memory.memory.id)).toEqual(['procedural-1', 'project-1'])
  })

  it('retrieves conversation memories without surfacing high-sensitivity affective content', async () => {
    const cwd = await createTempDir()
    await writeActiveMemories(cwd, [
      createMemory({ id: 'personal-1', domain: 'personal', type: 'interaction_style', content: 'User prefers direct conclusions.' }),
      createMemory({
        id: 'affect-sensitive',
        domain: 'affective',
        type: 'affective_pattern',
        content: 'User is anxious about memory design.',
        safety: 0.7,
        sensitivity: 0.8
      })
    ])

    const memories = await retrieveMemories({
      cwd,
      userCyreneDir: join(cwd, '.cyrene'),
      query: 'memory design',
      task: 'conversation',
      maxItems: 10,
      maxTokens: 500
    })

    expect(memories.map((memory) => memory.memory.id)).toEqual(['personal-1'])
    expect(formatMemoryContext(memories)).toContain('User prefers direct conclusions.')
  })

  it('retrieves procedural response rules during conversation', async () => {
    const cwd = await createTempDir()
    await writeActiveMemories(cwd, [
      createMemory({
        id: 'architecture-order',
        domain: 'procedural',
        type: 'procedural_rule',
        content: 'When user asks for architecture plan, first give conclusion, then risks, then execution steps.',
        tags: ['architecture', 'response-format']
      })
    ])

    const memories = await retrieveMemories({
      cwd,
      userCyreneDir: join(cwd, '.cyrene'),
      query: '我之后问架构方案时，你应该怎么组织回答？',
      task: 'conversation',
      maxItems: 10,
      maxTokens: 500
    })

    expect(memories.map((memory) => memory.memory.id)).toEqual(['architecture-order'])
    expect(formatMemoryContext(memories)).toContain('first give conclusion, then risks, then execution steps')
  })

  it('respects maxItems and maxTokens', async () => {
    const cwd = await createTempDir()
    await writeActiveMemories(cwd, [
      createMemory({ id: 'one', content: 'Alpha memory with provider details.' }),
      createMemory({ id: 'two', content: 'Beta memory with provider details.' }),
      createMemory({ id: 'three', content: 'Gamma memory with provider details.' })
    ])

    const memories = await retrieveMemories({
      cwd,
      userCyreneDir: join(cwd, '.cyrene'),
      query: 'provider',
      task: 'memory',
      maxItems: 2,
      maxTokens: 12
    })

    expect(memories).toHaveLength(2)
    expect(formatMemoryContext(memories).split(/\s+/).length).toBeLessThanOrEqual(20)
  })
})

function createMemory(input: {
  id: string
  domain?: MemoryDomain
  type?: MemoryType
  strength?: MemoryStrength
  content?: string
  safety?: number
  sensitivity?: number
  tags?: string[]
}): CyreneMemory {
  return {
    id: input.id,
    domain: input.domain ?? 'project',
    type: input.type ?? 'project_fact',
    strength: input.strength ?? 'hard',
    scope: input.domain === 'personal' || input.domain === 'relationship' || input.domain === 'affective' ? 'global' : 'project',
    status: 'active',
    content: input.content ?? 'Cyrene uses typed memory.',
    normalizedKey: input.id,
    evidence: [{ runId: 'run-1', summary: 'Test evidence.' }],
    source: 'assistant_observed',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.8,
      safety: input.safety ?? 0.95,
      sensitivity: input.sensitivity ?? 0.1
    },
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    tags: input.tags ?? []
  }
}
