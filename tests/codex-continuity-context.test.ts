import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { getCodexContinuityContext } from '../src/codex/continuity-context.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { CyreneMemory, PendingMemory } from '../src/memory/types.js'

const execFileAsync = promisify(execFile)
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

describe('Codex continuity context', () => {
  it('returns compact project, memory, strategy, and dissent context', async () => {
    const home = await createTempDir('cyrene-codex-continuity-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    await execFileAsync('git', ['remote', 'add', 'origin', 'git@github.com:example/cyrene-demo.git'], { cwd: repo })
    const identity = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'index.jsonl'), JSON.stringify(createMemory()) + '\n')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'This is risky: should we skip the validator and write active affect memory?',
      task: 'planning'
    })

    expect(context.project).toEqual({
      projectId: identity.projectId,
      displayName: identity.displayName
    })
    expect(context.memory.items).toEqual([
      {
        id: 'memory-1',
        domain: 'project',
        type: 'project_fact',
        strength: 'hard',
        content: 'Phase 3 affective memory must go through pending validation.'
      }
    ])
    expect(context.strategy.shouldChallengeUser).toBe(true)
    expect(context.dissent.shouldChallenge).toBe(true)
    expect(JSON.stringify(context)).not.toContain('git@github.com')
  })

  it('includes global active memory from the Codex global memory root in any project context', async () => {
    const home = await createTempDir('cyrene-codex-continuity-global-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-global-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    await execFileAsync('git', ['remote', 'add', 'origin', 'git@github.com:example/other-project.git'], { cwd: repo })
    const identity = await identifyCodexProject(repo)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const globalMemoryRoot = join(home, '.cyrene', 'codex', 'global', 'memory')
    await mkdir(projectMemoryRoot, { recursive: true })
    await mkdir(globalMemoryRoot, { recursive: true })
    await writeFile(join(projectMemoryRoot, 'index.jsonl'), JSON.stringify(createMemory()) + '\n')
    await writeFile(
      join(globalMemoryRoot, 'index.jsonl'),
      JSON.stringify(createMemory({
        id: 'global-memory-1',
        domain: 'procedural',
        type: 'procedural_rule',
        scope: 'global',
        content: 'Specs and plans default to Chinese in all projects.',
        normalizedKey: 'global-spec-plan-chinese'
      })) + '\n'
    )

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'For this Phase memory spec plan, what durable workflow rules apply?',
      task: 'planning'
    })

    expect(context.memory.items.map((item) => item.content)).toEqual(
      expect.arrayContaining([
        'Phase 3 affective memory must go through pending validation.',
        'Specs and plans default to Chinese in all projects.'
      ])
    )
  })

  it('returns strategy when no Codex memory exists yet', async () => {
    const home = await createTempDir('cyrene-codex-continuity-empty-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-empty-repo-')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'Summarize this repo.',
      task: 'coding'
    })

    expect(context.project.projectId).toMatch(/^[a-f0-9]{16}$/)
    expect(context.memory.items).toEqual([])
    expect(context.strategy.tone).toBeDefined()
    expect(context.dissent.mode).toBeDefined()
  })

  it('returns pending review notice without exposing pending content as active memory', async () => {
    const home = await createTempDir('cyrene-codex-continuity-pending-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-pending-repo-')
    const identity = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const pending = createPendingMemory()
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), JSON.stringify(pending) + '\n')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'Review pending memory.',
      task: 'memory'
    })

    expect(context.pendingReview).toEqual({
      count: 1,
      hasItems: true,
      newestCandidateId: pending.id,
      newestPreview: pending.content
    })
    expect(context.memory.items).toEqual([])
  })
})

function createMemory(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'memory-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Phase 3 affective memory must go through pending validation.',
    normalizedKey: 'phase-3-affective-memory-validator',
    evidence: [{ runId: 'run-1', summary: 'Spec decision.' }],
    source: 'assistant_observed',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    tags: ['codex'],
    ...overrides
  }
}

function createPendingMemory(): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Pending memory content must not appear as active continuity memory.',
    normalizedKey: 'pending-memory-not-active',
    evidence: [{ runId: 'run-pending', summary: 'Pending review notice test.' }],
    source: 'assistant_observed',
    scores: {
      evidenceStrength: 0.8,
      stability: 0.7,
      usefulness: 0.7,
      safety: 0.9,
      sensitivity: 0.2
    },
    seenCount: 1,
    firstSeenAt: '2026-05-25T00:00:00.000Z',
    lastSeenAt: '2026-05-25T00:00:00.000Z',
    expiresAt: '2026-06-24T00:00:00.000Z',
    tags: ['codex']
  }
}
