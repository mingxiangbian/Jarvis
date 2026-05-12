import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { runAgentLoop } from '../src/agent-loop.js'
import { createDefaultConfig } from '../src/config.js'
import type { ChatMessage, ModelResponse } from '../src/llm-client.js'
import type { Tool } from '../src/tools/types.js'

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
  isConcurrencySafe: false,
  needsUserInteraction: false,
  async execute(args) {
    return { ok: true, content: args.text }
  }
}

describe('runAgentLoop', () => {
  it('returns assistant text when no tool calls are requested', async () => {
    const result = await runAgentLoop({
      config: createDefaultConfig('/tmp/project'),
      systemPrompt: 'system',
      userPrompt: 'hello',
      tools: [],
      callModel: async (): Promise<ModelResponse> => ({ content: 'final answer', toolCalls: [] })
    })

    expect(result.finalText).toBe('final answer')
  })

  it('executes tool calls and feeds the result back to the model', async () => {
    let calls = 0
    const seenMessages: ChatMessage[][] = []
    const result = await runAgentLoop({
      config: createDefaultConfig('/tmp/project'),
      systemPrompt: 'system',
      userPrompt: 'echo',
      tools: [echoTool],
      callModel: async ({ messages }): Promise<ModelResponse> => {
        calls += 1
        seenMessages.push([...messages])
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'echo', arguments: '{"text":"tool output"}' }
              }
            ]
          }
        }
        return { content: 'done after tool', toolCalls: [] }
      }
    })

    expect(result.finalText).toBe('done after tool')
    expect(result.toolCallCount).toBe(1)
    expect(seenMessages[1]?.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: 'tool output'
    })
  })

  it('asks the model for a final answer when it returns blank text after tools', async () => {
    let calls = 0
    const seenMessages: ChatMessage[][] = []
    const result = await runAgentLoop({
      config: createDefaultConfig('/tmp/project'),
      systemPrompt: 'system',
      userPrompt: 'echo',
      tools: [echoTool],
      callModel: async ({ messages }): Promise<ModelResponse> => {
        calls += 1
        seenMessages.push([...messages])
        if (calls === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'echo', arguments: '{"text":"tool output"}' }
              }
            ]
          }
        }
        if (calls === 2) {
          return { content: '\n\n', toolCalls: [] }
        }
        return { content: 'final after retry', toolCalls: [] }
      }
    })

    expect(result.finalText).toBe('final after retry')
    expect(result.toolCallCount).toBe(1)
    expect(seenMessages[2]?.at(-1)).toEqual({
      role: 'user',
      content: 'Your previous response was empty. Provide a clear final answer using the tool results above, or call another tool if needed.'
    })
  })

  it('allows another blank final retry after new tool results', async () => {
    let calls = 0
    const result = await runAgentLoop({
      config: createDefaultConfig('/tmp/project'),
      systemPrompt: 'system',
      userPrompt: 'echo',
      tools: [echoTool],
      callModel: async (): Promise<ModelResponse> => {
        calls += 1
        if (calls === 1 || calls === 3) {
          return {
            content: '',
            toolCalls: [
              {
                id: `call-${calls}`,
                type: 'function',
                function: { name: 'echo', arguments: '{"text":"tool output"}' }
              }
            ]
          }
        }
        if (calls === 2 || calls === 4) {
          return { content: '\n\n', toolCalls: [] }
        }
        return { content: 'final after second retry', toolCalls: [] }
      }
    })

    expect(result.finalText).toBe('final after second retry')
    expect(result.toolCallCount).toBe(2)
  })
})
