import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { runAgentLoop } from '../src/agent-loop.js'
import { createDefaultConfig } from '../src/config.js'
import type { ModelResponse } from '../src/llm-client.js'
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
  const dir = await mkdtemp(join(tmpdir(), 'cc-local-memory-v2-'))
  tempDirs.push(dir)
  return dir
}

describe('Memory v2 integration', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('records daily tool facts and promotes them into durable project memory', async () => {
    const home = await createTempDir()
    const userCcLocalDir = join(home, '.cc-local')
    const project = join(home, 'workspace', 'project')
    await mkdir(join(project, '.cc-local'), { recursive: true })
    await mkdir(join(home, 'workspace', '.cc-local'), { recursive: true })
    await mkdir(userCcLocalDir, { recursive: true })
    await writeFile(join(userCcLocalDir, 'soul.md'), 'Be concise.\n')
    await writeFile(join(userCcLocalDir, 'Rule.md'), 'Global rule.\n')
    await writeFile(join(home, 'workspace', '.cc-local', 'Rule.md'), 'Workspace rule.\n')

    const config = { ...createDefaultConfig(project), userCcLocalDir }
    let modelCalls = 0
    const result = await runAgentLoop({
      config,
      systemPrompt: 'system',
      userPrompt: 'record this',
      tools: [echoTool],
      callModel: async (): Promise<ModelResponse> => {
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

        return { content: 'done', toolCalls: [] }
      }
    })

    expect(result.finalText).toBe('done')
    await expect(loadDaily(project, 10)).resolves.toMatch(/## Recent Daily Memory\n\n\[\d{2}:\d{2}\] echo -> ok/)
    const dailyRaw = await loadDailyRaw(project)

    await expect(
      compactMemories({
        cwd: project,
        dailyContent: dailyRaw,
        config,
        callModel: async () => ({
          content: JSON.stringify([
            {
              title: 'Echo fact',
              file: 'echo-fact.md',
              summary: 'echo tool recorded a fact',
              content: 'The echo tool recorded memory fact.\n'
            }
          ]),
          toolCalls: []
        })
      })
    ).resolves.toEqual({ ok: true, promoted: 1 })

    await expect(loadDailyRaw(project)).resolves.toBe('')
    await expect(readFile(join(project, '.cc-local', 'memory', 'daily.archive.md'), 'utf8')).resolves.toBe(dailyRaw)
    await expect(loadProjectMemories(project)).resolves.toBe(
      '## Project Memory: Echo fact\n\nThe echo tool recorded memory fact.'
    )
    await expect(loadSoul(userCcLocalDir)).resolves.toBe('## Global Persona\n\nBe concise.')
    await expect(loadRuleStack(project, userCcLocalDir)).resolves.toContain('Workspace rule.')
  })
})
