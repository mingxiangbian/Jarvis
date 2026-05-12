import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createDefaultConfig } from '../src/config.js'
import type { CallModelInput, ChatMessage, ModelResponse } from '../src/llm-client.js'
import { runReplTurn } from '../src/repl.js'
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
