import { afterEach, describe, expect, it, vi } from 'vitest'
import { callModel } from '../src/llm-client.js'
import { createDefaultConfig } from '../src/config.js'

describe('callModel', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts an OpenAI-compatible chat completion request and returns content', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hello from model' } }]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetch)
    const config = createDefaultConfig('/tmp/project')
    config.model.baseUrl = 'http://127.0.0.1:8080/v1'
    config.model.model = 'local-model'
    config.model.temperature = 0.2
    const messages = [{ role: 'user' as const, content: 'Say hello' }]
    const tools = [
      {
        type: 'function',
        function: {
          name: 'echo',
          description: 'Echo text.',
          parameters: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text']
          }
        }
      }
    ]

    const result = await callModel({ config, messages, tools })

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8080/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'local-model',
        temperature: 0.2,
        messages,
        tools,
        tool_choice: 'auto'
      })
    })
    expect(result).toEqual({ content: 'hello from model', toolCalls: [] })
  })

  it('returns tool calls from the first assistant message', async () => {
    const toolCalls = [
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'echo', arguments: '{"text":"hello"}' }
      }
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: null, tool_calls: toolCalls } }]
          }),
          { status: 200 }
        )
      )
    )

    const result = await callModel({
      config: createDefaultConfig('/tmp/project'),
      messages: [{ role: 'user', content: 'Use a tool' }],
      tools: []
    })

    expect(result).toEqual({ content: '', toolCalls })
  })

  it('throws a helpful error when the endpoint returns a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('model unavailable', { status: 503 }))
    )

    await expect(
      callModel({
        config: createDefaultConfig('/tmp/project'),
        messages: [{ role: 'user', content: 'Hello' }],
        tools: []
      })
    ).rejects.toThrow('LLM request failed with HTTP 503: model unavailable')
  })
})
