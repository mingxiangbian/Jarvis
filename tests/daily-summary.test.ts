import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig } from '../src/config.js'
import {
  buildDailySummaryPrompt,
  hasDailyMemorySignal,
  maybeAppendDailySummary,
  parseDailySummaryResponse,
  validateDailySummary
} from '../src/daily-summary.js'
import type { CallModelInput, ModelResponse } from '../src/llm-client.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-local-daily-summary-'))
  tempDirs.push(dir)
  return dir
}

describe('daily summary filtering', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('skips short ordinary conversations without calling the model', async () => {
    const root = await createTempDir()
    const callModel = vi.fn(async (_input: CallModelInput): Promise<ModelResponse> => ({
      content: '{"shouldRemember":true,"summary":"Should not be used."}',
      toolCalls: []
    }))

    const result = await maybeAppendDailySummary({
      cwd: root,
      config: createDefaultConfig(root),
      userPrompt: 'thanks',
      finalText: 'ok',
      callModel,
      now: new Date('2026-05-20T06:30:00Z')
    })

    expect(result).toBe(false)
    expect(callModel).not.toHaveBeenCalled()
    await expect(readFile(join(root, '.cc-local', 'memory', 'daily.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('appends one validated content summary for a memory-worthy turn', async () => {
    const root = await createTempDir()
    await mkdir(join(root, '.cc-local', 'memory'), { recursive: true })
    const callModel = vi.fn(async (_input: CallModelInput): Promise<ModelResponse> => ({
      content: JSON.stringify({
        shouldRemember: true,
        summary: 'User prefers daily memory to store content summaries instead of tool-call logs.'
      }),
      toolCalls: []
    }))

    const result = await maybeAppendDailySummary({
      cwd: root,
      config: createDefaultConfig(root),
      userPrompt: '我希望 memory 记住内容，不要记录工具调用。',
      finalText: '已确认：daily.md 应保存内容摘要，普通工具调用跳过。',
      callModel,
      now: new Date('2026-05-20T06:30:00Z')
    })

    expect(result).toBe(true)
    expect(callModel).toHaveBeenCalledTimes(1)
    await expect(readFile(join(root, '.cc-local', 'memory', 'daily.md'), 'utf8')).resolves.toBe(
      '[2026-05-20 06:30] User prefers daily memory to store content summaries instead of tool-call logs.\n'
    )
  })

  it('returns false when a valid daily summary cannot be appended', async () => {
    const root = await createTempDir()
    const callModel = vi.fn(async (_input: CallModelInput): Promise<ModelResponse> => ({
      content: JSON.stringify({
        shouldRemember: true,
        summary: 'User prefers daily memory to store content summaries instead of tool-call logs.'
      }),
      toolCalls: []
    }))

    await expect(
      maybeAppendDailySummary({
        cwd: root,
        config: createDefaultConfig(root),
        userPrompt: 'Remember this preference.',
        finalText: 'Use daily memory for durable content summaries.',
        callModel,
        appendDaily: async () => {
          throw new Error('daily unavailable')
        },
        now: new Date('2026-05-20T06:30:00Z')
      })
    ).resolves.toBe(false)
  })

  it('rejects invalid, generic, and operational summaries', async () => {
    const config = createDefaultConfig('/tmp/project')

    expect(parseDailySummaryResponse('not json')).toBeNull()
    expect(parseDailySummaryResponse('{"shouldRemember":false,"summary":"Ignored."}')).toEqual({
      shouldRemember: false,
      summary: 'Ignored.'
    })
    expect(validateDailySummary('User asked a question.', config)).toBe(false)
    expect(validateDailySummary('glob -> ok', config)).toBe(false)
    expect(validateDailySummary('Edited src/agent-loop.ts.', config)).toBe(false)
    expect(validateDailySummary('Modified src/daily-summary.ts to add memory validation.', config)).toBe(false)
    expect(validateDailySummary('Updated src/agent-loop.ts for memory behavior.', config)).toBe(false)
    expect(
      validateDailySummary(
        'Decision: daily memory should store content summaries.\nFollow-up: keep filtering conservative.',
        config
      )
    ).toBe(false)
    expect(
      validateDailySummary(
        'Decision: daily memory should skip ordinary tool calls and remember durable content summaries.',
        config
      )
    ).toBe(true)
  })

  it('builds a prompt that explicitly forbids tool and file edit logs', () => {
    const prompt = buildDailySummaryPrompt({
      userPrompt: 'Please remember my preference.',
      finalText: 'Decision: remember content, not tool logs.'
    })

    expect(prompt).toContain('Return only JSON')
    expect(prompt).toContain('Do not summarize routine tool calls')
    expect(prompt).toContain('Do not write file-edit logs')
    expect(prompt).toContain('User prompt:')
    expect(prompt).toContain('Assistant final answer:')
  })

  it('uses hard signals before asking the model', () => {
    expect(hasDailyMemorySignal('hello', 'ok')).toBe(false)
    expect(hasDailyMemorySignal('Remember this preference.', 'ok')).toBe(true)
    expect(hasDailyMemorySignal('记住：默认跳过工具日志', '好的')).toBe(true)
    expect(hasDailyMemorySignal('我希望以后默认跳过工具调用日志，并且只保存有长期价值的内容记忆。', '确认这个偏好。')).toBe(true)
    expect(hasDailyMemorySignal('What was the root cause?', 'Root cause: daily logging appends every tool call.')).toBe(true)
    expect(hasDailyMemorySignal('继续', 'Done.')).toBe(false)
  })
})
