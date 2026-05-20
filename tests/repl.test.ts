import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createDefaultConfig } from '../src/config.js'
import type { CompactDailyIfNeededInput } from '../src/daily-compaction.js'
import type { CallModelInput, ChatMessage, ModelResponse } from '../src/llm-client.js'
import { runRepl, runReplTurn } from '../src/repl.js'
import { appendSessionEvent, createSession, loadSession } from '../src/session-store.js'
import type { Tool } from '../src/tools/types.js'
import type { AgentObserver } from '../src/ui-observer.js'

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

    expect(result).toEqual({ kind: 'agent', finalText: 'hello back', toolCallCount: 0 })
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

    expect(secondResult).toEqual({ kind: 'agent', finalText: 'second answer', toolCallCount: 0 })
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

    expect(result).toEqual({ kind: 'exit' })
    expect(callModel).not.toHaveBeenCalled()
    expect(messages).toEqual([{ role: 'system', content: 'system rules' }])
  })

  it('handles empty input without calling the model or mutating history', async () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 'system rules' }]
    const callModel = vi.fn(
      async (_input: CallModelInput): Promise<ModelResponse> => ({ content: 'unused', toolCalls: [] })
    )

    const result = await runReplTurn({
      config: createDefaultConfig('/tmp/project'),
      messages,
      input: '   ',
      tools: [],
      callModel
    })

    expect(result).toEqual({ kind: 'handled' })
    expect(callModel).not.toHaveBeenCalled()
    expect(messages).toEqual([{ role: 'system', content: 'system rules' }])
  })

  it('handles /help and /model without calling the model', async () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 'system rules' }]
    const config = createDefaultConfig('/tmp/project')
    const callModel = vi.fn(
      async (_input: CallModelInput): Promise<ModelResponse> => ({ content: 'unused', toolCalls: [] })
    )

    await expect(runReplTurn({ config, messages, input: '/help', tools: [], callModel })).resolves.toEqual({
      kind: 'handled',
      output: ['Commands:', '  /help          Show this help', '  /model         Show model info', '  exit, quit, q  Exit REPL'].join('\n')
    })
    await expect(runReplTurn({ config, messages, input: '/model', tools: [], callModel })).resolves.toEqual({
      kind: 'handled',
      output: [`Model:  ${config.model.model}`, `API:    ${config.model.baseUrl}`].join('\n')
    })
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

    expect(secondResult).toEqual({ kind: 'agent', finalText: 'second done', toolCallCount: 1 })
  })

  it('passes the observer through to the agent loop', async () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 'system rules' }]
    const events: string[] = []
    const observer: AgentObserver = {
      onThinkingStart: () => events.push('thinking:start'),
      onThinkingStop: () => events.push('thinking:stop'),
      onToolCallStart: () => events.push('tool:start'),
      onToolCallResult: () => events.push('tool:result'),
      onResponse: () => events.push('response')
    }

    const result = await runReplTurn({
      config: createDefaultConfig('/tmp/project'),
      messages,
      input: 'hello',
      tools: [],
      observer,
      callModel: async (): Promise<ModelResponse> => ({ content: 'hello back', toolCalls: [] })
    })

    expect(result).toEqual({ kind: 'agent', finalText: 'hello back', toolCallCount: 0 })
    expect(events).toEqual(['thinking:start', 'thinking:stop', 'response'])
  })
})

describe('runRepl', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('delegates daily compaction after graceful exit', async () => {
    const config = createDefaultConfig('/tmp/project')
    const readline = createTestReadline(['exit'])
    const compactDailyIfNeeded = vi.fn(async (_input: CompactDailyIfNeededInput) => {})
    const callModel = vi.fn(async (_input: CallModelInput): Promise<ModelResponse> => ({ content: 'unused', toolCalls: [] }))
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runRepl({
        config,
        systemPrompt: 'system rules',
        tools: [],
        callModel,
        readline,
        compactDailyIfNeeded
      })
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Prism Agent'))
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining(config.model.model))
    } finally {
      consoleLog.mockRestore()
    }

    expect(readline.close).toHaveBeenCalledTimes(1)
    expect(callModel).not.toHaveBeenCalled()
    expect(compactDailyIfNeeded).toHaveBeenCalledWith({
      cwd: config.cwd,
      config,
      callModel
    })
  })

  it('still resolves graceful exit when daily compaction fails', async () => {
    const config = createDefaultConfig('/tmp/project')
    const readline = createTestReadline(['exit'])
    const compactDailyIfNeeded = vi.fn(async (_input: CompactDailyIfNeededInput) => {
      throw new Error('daily compaction failed')
    })
    const callModel = vi.fn(async (_input: CallModelInput): Promise<ModelResponse> => ({ content: 'unused', toolCalls: [] }))
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await expect(
        runRepl({
          config,
          systemPrompt: 'system rules',
          tools: [],
          callModel,
          readline,
          compactDailyIfNeeded
        })
      ).resolves.toBeUndefined()
    } finally {
      consoleLog.mockRestore()
    }

    expect(readline.close).toHaveBeenCalledTimes(1)
    expect(callModel).not.toHaveBeenCalled()
    expect(compactDailyIfNeeded).toHaveBeenCalledTimes(1)
  })

  it('prints the Prism mascot welcome before reading REPL input', async () => {
    const config = createDefaultConfig('/tmp/project')
    const readline = createTestReadline(['exit'])
    const compactDailyIfNeeded = vi.fn(async (_input: CompactDailyIfNeededInput) => {})
    const callModel = vi.fn(
      async (_input: CallModelInput): Promise<ModelResponse> => ({ content: 'unused', toolCalls: [] })
    )
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runRepl({
        config,
        systemPrompt: 'system rules',
        tools: [],
        callModel,
        readline,
        compactDailyIfNeeded
      })
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Prism Agent'))
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining(config.model.model))
    } finally {
      consoleLog.mockRestore()
    }
  })

  it('prints REPL tool-count metadata to stderr', async () => {
    const config = createDefaultConfig('/tmp/project')
    const readline = createTestReadline(['read file', 'exit'])
    const compactDailyIfNeeded = vi.fn(async (_input: CompactDailyIfNeededInput) => {})
    let callCount = 0
    const callModel = vi.fn(async (_input: CallModelInput): Promise<ModelResponse> => {
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

      return { content: 'read done', toolCalls: [] }
    })
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await runRepl({
        config,
        systemPrompt: 'system rules',
        tools: [trackReadTool],
        callModel,
        readline,
        compactDailyIfNeeded
      })
      expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('read done'))
      expect(consoleLog.mock.calls.flat()).not.toContainEqual(expect.stringContaining('tool calls:'))
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('tool calls: 1'))
    } finally {
      consoleLog.mockRestore()
      consoleError.mockRestore()
    }
  })

  it('resumes a stored session and appends the new REPL turn', async () => {
    const root = await createTempDir()
    const config = createDefaultConfig(root)
    const session = await createSession({
      cwd: root,
      mode: 'repl',
      model: config.model.model,
      id: 'repl-session',
      firstUserMessage: { role: 'user', content: 'first question' }
    })
    await appendSessionEvent({
      cwd: root,
      sessionId: session.id,
      event: { type: 'message', message: { role: 'assistant', content: 'first answer' } }
    })

    const seenMessages: ChatMessage[][] = []
    const readline = createTestReadline(['next question', 'exit'])
    const compactDailyIfNeeded = vi.fn(async (_input: CompactDailyIfNeededInput) => {})
    const callModel = vi.fn(async (input: CallModelInput): Promise<ModelResponse> => {
      seenMessages.push(input.messages.map((message) => ({ ...message })))
      return { content: 'next answer', toolCalls: [] }
    })
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await runRepl({
        config,
        systemPrompt: 'system rules',
        tools: [],
        callModel,
        readline,
        compactDailyIfNeeded,
        resumeSessionId: session.id
      })
    } finally {
      consoleLog.mockRestore()
    }

    expect(seenMessages[0]).toEqual([
      { role: 'system', content: 'system rules' },
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'next question' }
    ])
    await expect(loadSession({ cwd: root, sessionId: session.id, recentMessages: 10 })).resolves.toEqual({
      session: expect.objectContaining({ id: session.id }),
      messages: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'next question' },
        { role: 'assistant', content: 'next answer' }
      ],
      modelMessages: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'next question' },
        { role: 'assistant', content: 'next answer' }
      ]
    })
  })

  it('does not compact daily memory when a turn fails before graceful exit', async () => {
    const readline = createTestReadline(['hello'])
    const compactDailyIfNeeded = vi.fn(async (_input: CompactDailyIfNeededInput) => {})
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
          compactDailyIfNeeded
        })
      ).rejects.toThrow('model failed')
    } finally {
      consoleLog.mockRestore()
    }

    expect(readline.close).toHaveBeenCalledTimes(1)
    expect(callModel).toHaveBeenCalledTimes(1)
    expect(compactDailyIfNeeded).not.toHaveBeenCalled()
  })
})
