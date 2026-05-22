import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { runAgentLoop } from '../src/agent-loop.js'
import { createDefaultConfig } from '../src/config.js'
import type { CallModelInput, ModelResponse } from '../src/llm-client.js'
import {
  compactMemories,
  loadDaily,
  loadDailyRaw,
  loadProjectMemories,
  loadRuleStack,
  loadSoul
} from '../src/memory.js'
import type { Tool } from '../src/tools/types.js'

const tempDirs: string[] = []

const echoTool: Tool<{ text: string }> = {
  name: 'echo',
  description: 'Echo text.',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false
  },
  schema: z.object({ text: z.string() }),
  isReadonly: true,
  isDestructive: false,
  isConcurrencySafe: true,
  needsUserInteraction: false,
  async execute(args) {
    return { ok: true, content: args.text }
  }
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-memory-v2-'))
  tempDirs.push(dir)
  return dir
}

describe('Memory v2 integration', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('records daily content summaries and promotes them into durable project memory', async () => {
    const home = await createTempDir()
    const userJarvisDir = join(home, '.jarvis')
    const project = join(home, 'workspace', 'project')
    await mkdir(join(project, '.jarvis'), { recursive: true })
    await mkdir(join(home, 'workspace', '.jarvis'), { recursive: true })
    await mkdir(userJarvisDir, { recursive: true })
    await writeFile(join(userJarvisDir, 'soul.md'), 'Be concise.\n')
    await writeFile(join(userJarvisDir, 'Rule.md'), 'Global rule.\n')
    await writeFile(join(home, 'workspace', '.jarvis', 'Rule.md'), 'Workspace rule.\n')

    const config = { ...createDefaultConfig(project), userJarvisDir }
    let modelCalls = 0
    const result = await runAgentLoop({
      config,
      systemPrompt: 'system',
      userPrompt: 'Remember the decision that daily memory should store content summaries instead of tool-call logs.',
      tools: [echoTool],
      callModel: async ({ tools }: CallModelInput): Promise<ModelResponse> => {
        if (tools.length === 0) {
          return {
            content: JSON.stringify({
              shouldRemember: true,
              summary: 'Decision: daily memory stores durable content summaries instead of tool-call logs.'
            }),
            toolCalls: []
          }
        }

        modelCalls += 1
        if (modelCalls === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-echo',
                type: 'function',
                function: { name: 'echo', arguments: '{"text":"memory fact"}' }
              }
            ]
          }
        }

        return {
          content: 'Decision confirmed: daily memory stores durable content summaries instead of tool-call logs.',
          toolCalls: []
        }
      }
    })

    expect(result.finalText).toBe(
      'Decision confirmed: daily memory stores durable content summaries instead of tool-call logs.'
    )
    await expect(loadDaily(project, 10)).resolves.toContain(
      'Decision: daily memory stores durable content summaries instead of tool-call logs.'
    )
    const dailyRaw = await loadDailyRaw(project)

    await expect(
      compactMemories({
        cwd: project,
        dailyContent: dailyRaw,
        config,
        callModel: async () => ({
          content: JSON.stringify([
            {
              title: 'Daily Memory Content Summaries',
              file: 'daily-memory-content-summaries.md',
              type: 'project',
              summary: 'Daily memory stores durable content summaries instead of tool-call logs.',
              content: 'Daily memory stores durable content summaries instead of tool-call logs.\n'
            }
          ]),
          toolCalls: []
        })
      })
    ).resolves.toEqual({ ok: true, promoted: 1 })

    await expect(loadDailyRaw(project)).resolves.toBe('')
    await expect(readFile(join(project, '.jarvis', 'memory', 'daily.archive.md'), 'utf8')).resolves.toBe(dailyRaw)
    await expect(loadProjectMemories(project)).resolves.toBe(
      '## Project Memory [project]: Daily Memory Content Summaries\n\nDaily memory stores durable content summaries instead of tool-call logs.'
    )
    await expect(loadSoul(userJarvisDir)).resolves.toBe('## Global Persona\n\nBe concise.')
    await expect(loadRuleStack(project, userJarvisDir)).resolves.toContain('Workspace rule.')
  })
})
