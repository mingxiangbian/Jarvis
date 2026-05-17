import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createDefaultConfig } from '../src/config.js'
import type { CallModelInput, ChatMessage, ModelResponse } from '../src/llm-client.js'
import { runRepl, runReplTurn } from '../src/repl.js'
import type { Tool } from '../src/tools/types.js'

const trackReadTool: Tool<Record<string, never>> = {
  name: 'track_read',
  description: 'Track a fake read.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false
  },
  schema: z.object({}),
  isReadonly: true,
  isDestructive: false,
  isConcurrencySafe: false,
  needsUserInteraction: false,
  async execute(_args, context) {
    context.trackedFiles.add('/tmp/project/file.txt')
    return { ok: true, content: 'read tracked' }
  }
}

const requireReadTool: Tool<Record<string, never>> = {
  name: 'require_read',
  description: 'Require the fake read.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false
  },
  schema: z.object({}),
  isReadonly: false,
  isDestructive: true,
  isConcurrencySafe: false,
  needsUserInteraction: false,
  async execute(_args, context) {
    return context.trackedFiles.has('/tmp/project/file.txt')
      ? { ok: true, content: 'read still tracked' }
      : { ok: false, content: 'read tracking lost' }
  }
}

function createTestReadline(lines: string[]) {
  return {
    close: vi.fn(),
    question: vi.fn(async (_prompt: string) => {
      const line = lines.shift()
      if (line === undefined) {
        throw new Error('No test input remaining')
      }

      return line
    })
  }
}

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-local-repl-'))
  tempDirs.push(dir)
  return dir
}

describe('runReplTurn', () => {
  it('returns final text and preserves history across turns', async () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 'system rules' }]
    const seenMessages: ChatMessage[][] = []
    let callCount = 0
    const callModel = vi.fn(async ({ messages: modelMessages }: CallModelInput): Promise<ModelResponse> => {
      seenMessages.push([...modelMessages])
      callCount += 1
      return { content: callCount === 1 ? 'hello back' : 'second answer', toolCalls: [] }
    })

    const result = await runReplTurn({
      config: createDefaultConfig('/tmp/project'),
      messages,
      input: 'hello',
      tools: [],
      callModel
    })

    expect(result).toEqual({ exit: false, finalText: 'hello back', toolCallCount: 0 })
    expect(callModel).toHaveBeenCalledTimes(1)
    expect(seenMessages[0]).toEqual([
      { role: 'system', content: 'system rules' },
      { role: 'user', content: 'hello' }
    ])
    expect(messages).toEqual([
      { role: 'system', content: 'system rules' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hello back' }
    ])

    const secondResult = await runReplTurn({
      config: createDefaultConfig('/tmp/project'),
      messages,
      input: 'again',
      tools: [],
      callModel
    })

    expect(secondResult).toEqual({ exit: false, finalText: 'second answer', toolCallCount: 0 })
    expect(seenMessages[1]).toEqual([
      { role: 'system', content: 'system rules' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hello back' },
      { role: 'user', content: 'again' }
    ])
  })

  it.each(['exit', 'quit', 'q'])('treats %s as exit intent without calling the model', async (input) => {
    const messages: ChatMessage[] = [{ role: 'system', content: 'system rules' }]
    const callModel = vi.fn(
      async (_input: CallModelInput): Promise<ModelResponse> => ({ content: 'unused', toolCalls: [] })
    )

    const result = await runReplTurn({
      config: createDefaultConfig('/tmp/project'),
      messages,
      input,
      tools: [],
      callModel
    })

    expect(result).toEqual({ exit: true })
    expect(callModel).not.toHaveBeenCalled()
    expect(messages).toEqual([{ role: 'system', content: 'system rules' }])
  })

  it('preserves tool context across turns', async () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 'system rules' }]
    const config = createDefaultConfig('/tmp/project')
    const toolContext = { config, trackedFiles: new Set<string>() }
    let callCount = 0
    const callModel = vi.fn(async ({ messages: modelMessages }: CallModelInput): Promise<ModelResponse> => {
      callCount += 1
      if (callCount === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'call-read',
              type: 'function',
              function: { name: 'track_read', arguments: '{}' }
            }
          ]
        }
      }
      if (callCount === 2) {
        return { content: 'first done', toolCalls: [] }
      }
      if (callCount === 3) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'call-edit',
              type: 'function',
              function: { name: 'require_read', arguments: '{}' }
            }
          ]
        }
      }

      expect(modelMessages.at(-1)).toEqual({
        role: 'tool',
        tool_call_id: 'call-edit',
        content: 'read still tracked'
      })
      return { content: 'second done', toolCalls: [] }
    })

    await runReplTurn({
      config,
      messages,
      input: 'read file',
      tools: [trackReadTool, requireReadTool],
      toolContext,
      callModel
    })

    const secondResult = await runReplTurn({
      config,
      messages,
      input: 'edit file',
      tools: [trackReadTool, requireReadTool],
      toolContext,
      callModel
    })

    expect(secondResult).toEqual({ exit: false, finalText: 'second done', toolCallCount: 1 })
  })
})

describe('runRepl', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('compacts daily memory after graceful exit when the threshold is reached', async () => {
    const root = await createTempDir()
    const memoryDir = join(root, '.cc-local', 'memory')
    await mkdir(memoryDir, { recursive: true })
    await writeFile(join(memoryDir, 'daily.md'), 'one\ntwo\n')
    const config = { ...createDefaultConfig(root), dailyCompactThreshold: 2 }
    const readline = createTestReadline(['exit'])
    const compactMemories = vi.fn(async (_input) => ({ ok: true as const, promoted: 1 }))
    const callModel = vi.fn(async (_input: CallModelInput): Promise<ModelResponse> => ({ content: 'unused', toolCalls: [] }))
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runRepl({
        config,
        systemPrompt: 'system rules',
        tools: [],
        callModel,
        readline,
        compactMemories
      })
    } finally {
      consoleLog.mockRestore()
    }

    expect(readline.close).toHaveBeenCalledTimes(1)
    expect(callModel).not.toHaveBeenCalled()
    expect(compactMemories).toHaveBeenCalledWith({
      cwd: root,
      dailyContent: 'one\ntwo\n',
      config,
      callModel
    })
  })

  it('skips daily compaction when the threshold is not reached', async () => {
    const root = await createTempDir()
    const memoryDir = join(root, '.cc-local', 'memory')
    await mkdir(memoryDir, { recursive: true })
    await writeFile(join(memoryDir, 'daily.md'), 'one\n')
    const config = { ...createDefaultConfig(root), dailyCompactThreshold: 2 }
    const readline = createTestReadline(['exit'])
    const compactMemories = vi.fn(async (_input) => ({ ok: true as const, promoted: 1 }))
    const callModel = vi.fn(async (_input: CallModelInput): Promise<ModelResponse> => ({ content: 'unused', toolCalls: [] }))
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runRepl({
        config,
        systemPrompt: 'system rules',
        tools: [],
        callModel,
        readline,
        compactMemories
      })
    } finally {
      consoleLog.mockRestore()
    }

    expect(compactMemories).not.toHaveBeenCalled()
    await expect(readFile(join(memoryDir, 'daily.md'), 'utf8')).resolves.toBe('one\n')
  })

  it('does not compact daily memory when a turn fails before graceful exit', async () => {
    const readline = createTestReadline(['hello'])
    const compactMemories = vi.fn(async (_input) => ({ ok: true as const, promoted: 1 }))
    const callModel = vi.fn(async (_input: CallModelInput): Promise<ModelResponse> => {
      throw new Error('model failed')
    })
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await expect(
        runRepl({
          config: createDefaultConfig('/tmp/project'),
          systemPrompt: 'system rules',
          tools: [],
          callModel,
          readline,
          compactMemories
        })
      ).rejects.toThrow('model failed')
    } finally {
      consoleLog.mockRestore()
    }

    expect(readline.close).toHaveBeenCalledTimes(1)
    expect(callModel).toHaveBeenCalledTimes(1)
    expect(compactMemories).not.toHaveBeenCalled()
  })

  it('does not block graceful exit when daily compaction fails', async () => {
    const root = await createTempDir()
    const memoryDir = join(root, '.cc-local', 'memory')
    await mkdir(memoryDir, { recursive: true })
    await writeFile(join(memoryDir, 'daily.md'), 'one\ntwo\n')
    const config = { ...createDefaultConfig(root), dailyCompactThreshold: 2 }
    const readline = createTestReadline(['exit'])
    const compactMemories = vi.fn(async (_input) => ({ ok: false as const, error: 'bad json' }))
    const callModel = vi.fn(async (_input: CallModelInput): Promise<ModelResponse> => ({ content: 'unused', toolCalls: [] }))
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runRepl({
        config,
        systemPrompt: 'system rules',
        tools: [],
        callModel,
        readline,
        compactMemories
      })
    } finally {
      consoleLog.mockRestore()
    }

    expect(compactMemories).toHaveBeenCalledTimes(1)
    await expect(readFile(join(memoryDir, 'daily.md'), 'utf8')).resolves.toBe('one\ntwo\n')
  })
})
