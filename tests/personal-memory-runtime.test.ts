import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig, type AppConfig } from '../src/config.js'
import { buildMemoryCandidatePrompt, extractMemoryCandidates } from '../src/memory/memory-candidate-extractor.js'
import { processRunMemory } from '../src/memory/memory-runtime.js'
import { readActiveMemories, readPendingMemories } from '../src/memory/memory-store.js'
import type { CallModelInput, ModelResponse } from '../src/llm-client.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-personal-memory-runtime-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('personal memory runtime pipeline', () => {
  it('extracts candidates with domain strength and scores contract', async () => {
    const cwd = await createTempDir()
    const config = createDefaultConfig(cwd)
    const callModel = vi.fn(async (_input: CallModelInput): Promise<ModelResponse> => ({
      content: JSON.stringify({
        candidates: [
          {
            domain: 'project',
            type: 'project_fact',
            strength: 'hard',
            scope: 'project',
            content: 'Cyrene uses Personal Memory Core.',
            normalizedKey: 'cyrene-personal-memory-core',
            source: 'assistant_observed',
            scores: {
              evidenceStrength: 0.9,
              stability: 0.85,
              usefulness: 0.8,
              safety: 0.95,
              sensitivity: 0.1
            },
            evidence: [{ summary: 'User approved Phase 3 spec.' }],
            tags: ['memory']
          }
        ]
      }),
      toolCalls: []
    }))

    const candidates = await extractMemoryCandidates({
      cwd,
      config,
      runId: 'run-1',
      userPrompt: 'write plan',
      finalText: 'plan written',
      callModel
    })

    expect(callModel).toHaveBeenCalledWith(expect.objectContaining({ useCase: 'memory_extraction' }))
    expect(candidates).toMatchObject([
      {
        domain: 'project',
        strength: 'hard',
        normalizedKey: 'cyrene-personal-memory-core',
        status: 'pending',
        evidence: [{ runId: 'run-1', summary: 'User approved Phase 3 spec.' }]
      }
    ])
  })

  it('defaults affective candidates to session-scoped session memory', async () => {
    const candidates = await parseModelCandidates({
      candidates: [
        {
          domain: 'affective',
          type: 'affective_pattern',
          content: 'User benefits from direct architectural conclusions before rationale.',
          normalizedKey: 'direct-architecture-conclusions',
          source: 'assistant_observed',
          scores: {
            evidenceStrength: 0.78,
            stability: 0.7,
            usefulness: 0.8,
            safety: 0.92,
            sensitivity: 0.25
          },
          evidence: [{ summary: 'Repeated request for direct Phase 3 direction.' }],
          tags: ['interaction']
        }
      ]
    })

    expect(candidates[0]).toMatchObject({
      domain: 'affective',
      strength: 'session',
      scope: 'session'
    })
    expect(candidates[0]?.expiresAt).toBeDefined()
  })

  it('keeps assistant-observed run extraction pending', async () => {
    const cwd = await createTempDir()
    const config = createMemoryConfig(cwd, true)
    const callModel = createCandidateModel()

    const result = await processRunMemory({
      cwd,
      config,
      runId: 'run-1',
      userPrompt: 'remember this project fact',
      finalText: 'Cyrene uses Personal Memory Core.',
      callModel
    })

    expect(result).toMatchObject({ extracted: 1, created: 0, pending: 1, rejected: 0, errors: 0 })
    await expect(readActiveMemories(cwd)).resolves.toHaveLength(0)
    await expect(readPendingMemories(cwd)).resolves.toHaveLength(1)
  })

  it('keeps fenced assistant-observed JSON extraction responses pending', async () => {
    const cwd = await createTempDir()
    const config = createMemoryConfig(cwd, true)
    const callModel = createCandidateModel({ fenced: true })

    const result = await processRunMemory({
      cwd,
      config,
      runId: 'run-1',
      userPrompt: 'remember this project fact',
      finalText: 'Cyrene uses Personal Memory Core.',
      callModel
    })

    expect(result).toMatchObject({ extracted: 1, created: 0, pending: 1, rejected: 0, errors: 0 })
    await expect(readActiveMemories(cwd)).resolves.toHaveLength(0)
    await expect(readPendingMemories(cwd)).resolves.toHaveLength(1)
  })

  it('keeps extraction failure best-effort', async () => {
    const cwd = await createTempDir()
    const config = createMemoryConfig(cwd, true)
    const callModel = vi.fn(async () => {
      throw new Error('model unavailable')
    })

    const result = await processRunMemory({
      cwd,
      config,
      runId: 'run-1',
      userPrompt: 'hello',
      finalText: 'world',
      callModel
    })

    expect(result).toMatchObject({ extracted: 0, created: 0, pending: 0, rejected: 0, errors: 1 })
    await expect(readActiveMemories(cwd)).resolves.toEqual([])
  })

  it('does nothing when memoryAutoExtractEnabled is false', async () => {
    const cwd = await createTempDir()
    const config = createMemoryConfig(cwd, false)
    const callModel = createCandidateModel()

    const result = await processRunMemory({
      cwd,
      config,
      runId: 'run-1',
      userPrompt: 'hello',
      finalText: 'world',
      callModel
    })

    expect(result).toMatchObject({ extracted: 0, created: 0, pending: 0, rejected: 0, errors: 0 })
    expect(callModel).not.toHaveBeenCalled()
  })

  it('builds an extraction prompt with affective and relationship guardrails', () => {
    const prompt = buildMemoryCandidatePrompt({
      runId: 'run-1',
      userPrompt: 'hello',
      finalText: 'world'
    })

    expect(prompt).toContain('Do not infer psychological diagnoses')
    expect(prompt).toContain('Relationship candidates must describe boundaries')
    expect(prompt).toContain('If the user explicitly asks to remember temporary or session context, emit an episode candidate')
    expect(prompt).toContain('Episode candidates must use domain "personal", strength "session", and scope "session"')
  })
})

function createMemoryConfig(cwd: string, enabled: boolean): AppConfig {
  return {
    ...createDefaultConfig(cwd),
    memoryAutoExtractEnabled: enabled
  }
}

function createCandidateModel(options: { fenced?: boolean } = {}): (input: CallModelInput) => Promise<ModelResponse> {
  const payload = JSON.stringify({
    candidates: [
      {
        domain: 'project',
        type: 'project_fact',
        strength: 'hard',
        scope: 'project',
        content: 'Cyrene uses Personal Memory Core.',
        normalizedKey: 'cyrene-personal-memory-core',
        source: 'assistant_observed',
        scores: {
          evidenceStrength: 0.9,
          stability: 0.85,
          usefulness: 0.8,
          safety: 0.95,
          sensitivity: 0.1
        },
        evidence: [{ summary: 'The run completed Phase 3 memory work.' }],
        tags: ['memory']
      }
    ]
  })

  return vi.fn(async (_input: CallModelInput): Promise<ModelResponse> => ({
    content: options.fenced ? `\`\`\`json\n${payload}\n\`\`\`` : payload,
    toolCalls: []
  }))
}

async function parseModelCandidates(payload: unknown) {
  const cwd = await createTempDir()
  return extractMemoryCandidates({
    cwd,
    config: createDefaultConfig(cwd),
    runId: 'run-1',
    userPrompt: 'hello',
    finalText: 'world',
    callModel: vi.fn(async (): Promise<ModelResponse> => ({
      content: JSON.stringify(payload),
      toolCalls: []
    }))
  })
}
