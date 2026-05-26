import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { runCodexReviewSummary } from '../src/codex/review-summary-runtime.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { AppConfig } from '../src/config.js'
import type { CallModelInput, ModelResponse } from '../src/llm-client.js'

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

function createConfig(cwd: string): AppConfig {
  return {
    cwd,
    memoryCwd: cwd,
    model: {
      baseUrl: 'https://example.test',
      model: 'strong',
      apiKey: undefined,
      temperature: 0,
      provider: 'openai-compatible',
      strongModel: 'strong',
      cheapModel: 'cheap',
      thinkingMode: 'off'
    },
    features: {
      bashEnabled: true,
      webSearchEnabled: true,
      mcpEnabled: false
    },
    maxToolCallsPerTurn: 10,
    contextWindowTokens: 256_000,
    autoCompactThreshold: 0.7,
    snipThreshold: 0.4,
    microcompactThreshold: 0.5,
    collapseThreshold: 0.6,
    snipKeepRounds: 15,
    microcompactKeepRecentRounds: 5,
    userCyreneDir: join(cwd, '.cyrene'),
    sessionResumeRecentMessages: 40,
    memoryAutoExtractEnabled: true,
    evolutionEnabled: false,
    evolutionReflectionMode: 'manual',
    memoryMaxLines: 200,
    memoryMaxLineLength: 150,
    readMaxInlineLines: 500,
    grepMaxMatches: 30,
    bashTimeoutMs: 120_000,
    llmRequestTimeoutMs: 180_000,
    llmRetryMaxAttempts: 3,
    llmRetryBaseDelayMs: 1_000,
    readableRoots: [cwd],
    writableRoots: [cwd],
    bashDenyPatterns: []
  }
}

function modelResponse(content: string): ModelResponse {
  return { content, toolCalls: [] }
}

async function readReviewSummaries(cwd: string): Promise<string> {
  const identity = await identifyCodexProject(cwd)
  return readFile(join(codexProjectMemoryRoot(identity.projectId), 'review-summaries.jsonl'), 'utf8')
}

describe('Codex review summary runtime', () => {
  it('writes a redacted summary without pending candidates', async () => {
    const home = await createTempDir('cyrene-review-runtime-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-project-')
    const config = createConfig(cwd)
    const callModel = vi.fn(async (input: CallModelInput) => {
      expect(input.useCase).toBe('memory_extraction')
      return modelResponse(JSON.stringify({ summary: '用户要求整理 review-safe summary。', candidates: [] }))
    })

    const result = await runCodexReviewSummary({
      cwd,
      sessionId: 's1',
      turnId: 't1',
      messages: [{ role: 'user', content: '请总结本轮 review。' }],
      config,
      callModel,
      now: '2026-05-26T00:00:00.000Z'
    })

    expect(result.action).toBe('summary')
    if (result.action !== 'summary') throw new Error(`Expected summary, got ${result.action}`)
    expect(result.candidateIds).toEqual([])
    const summaries = await readReviewSummaries(cwd)
    expect(summaries).toContain('用户要求整理 review-safe summary。')
    await expect(readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes pending candidates from review-safe model output', async () => {
    const home = await createTempDir('cyrene-review-runtime-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-project-')
    const candidate = {
      domain: 'procedural',
      type: 'procedural_rule',
      strength: 'hard',
      scope: 'global',
      content: '以后在所有项目里，所有 spec 和 plan 默认用中文写。',
      normalizedKey: 'procedural-procedural-rule-spec-plan-chinese',
      source: 'user_explicit',
      scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.9, safety: 0.95, sensitivity: 0.1 },
      evidence: [{ summary: '用户明确要求 spec 和 plan 默认用中文写。' }],
      tags: ['codex-review-summary']
    }

    const result = await runCodexReviewSummary({
      cwd,
      messages: [{ role: 'user', content: '以后 spec 和 plan 默认用中文写。' }],
      config: createConfig(cwd),
      callModel: async () => modelResponse(JSON.stringify({ summary: '用户确认中文写作规则。', candidates: [candidate] })),
      now: '2026-05-26T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    if (result.action !== 'pending') throw new Error(`Expected pending, got ${result.action}`)
    expect(result.candidateIds).toHaveLength(1)
    const pending = await readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain('以后在所有项目里，所有 spec 和 plan 默认用中文写。')
    const summaries = await readReviewSummaries(cwd)
    expect(summaries).toContain(result.candidateIds[0])
  })

  it('redacts model output before writing summaries and candidates', async () => {
    const home = await createTempDir('cyrene-review-runtime-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-project-')

    const result = await runCodexReviewSummary({
      cwd,
      messages: [{ role: 'user', content: '请总结。' }],
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          summary: '模型泄漏 sk-abc1234567890abcdef1234567890',
          candidates: [
            {
              domain: 'project',
              type: 'project_fact',
              content: '密钥是 sk-abc1234567890abcdef1234567890',
              evidence: [{ summary: '看到了 sk-abc1234567890abcdef1234567890' }]
            }
          ]
        })),
      now: '2026-05-26T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    const summaries = await readReviewSummaries(cwd)
    expect(summaries).not.toContain('sk-abc')
    expect(summaries).toContain('[REDACTED_SECRET]')
    if (result.action === 'pending') {
      const pending = await readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')
      expect(pending).not.toContain('sk-abc')
      expect(pending).toContain('[REDACTED_SECRET]')
    }
  })

  it('writes a failed summary record when the model fails', async () => {
    const home = await createTempDir('cyrene-review-runtime-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-project-')

    const result = await runCodexReviewSummary({
      cwd,
      sessionId: 's1',
      turnId: 't1',
      messages: [{ role: 'user', content: '请总结。' }],
      config: createConfig(cwd),
      callModel: async () => {
        throw new Error('model unavailable')
      },
      now: '2026-05-26T00:00:00.000Z'
    })

    expect(result.action).toBe('summary_failed')
    const summaries = await readReviewSummaries(cwd)
    expect(summaries).toContain('Codex review summary failed; no transcript content persisted.')
    expect(summaries).toContain('model unavailable')
  })
})
