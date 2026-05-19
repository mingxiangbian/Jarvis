import { afterEach, describe, expect, it, vi } from 'vitest'
import { callModel } from '../src/llm-client.js'
import { createDefaultConfig } from '../src/config.js'

describe('callModel', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
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
      signal: expect.any(AbortSignal),
      body: JSON.stringify({
        model: 'local-model',
        temperature: 0.2,
        max_tokens: 4096,
        chat_template_kwargs: { enable_thinking: false },
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

  it('omits tool fields when no tools are provided', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'plain response' } }]
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetch)
    const config = createDefaultConfig('/tmp/project')
    config.model.model = 'local-model'
    const messages = [{ role: 'user' as const, content: 'Say hello' }]

    await callModel({ config, messages, tools: [] })

    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
  })

  it('throws a helpful error when the endpoint returns a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('model unavailable', { status: 503 }))
    )
    const config = createDefaultConfig('/tmp/project')
    config.llmRetryBaseDelayMs = 1

    await expect(
      callModel({
        config,
        messages: [{ role: 'user', content: 'Hello' }],
        tools: []
      })
    ).rejects.toThrow('LLM request failed with HTTP 503: model unavailable')
  })

  it('throws a helpful error when the endpoint cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const config = createDefaultConfig('/tmp/project')
    config.llmRetryBaseDelayMs = 1

    await expect(
      callModel({
        config,
        messages: [{ role: 'user', content: 'Hello' }],
        tools: []
      })
    ).rejects.toThrow('LLM request failed: fetch failed')
  })

  it('retries retryable failures before returning a successful response', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'recovered' } }]
          }),
          { status: 200 }
        )
      )
    vi.stubGlobal('fetch', fetch)
    const config = createDefaultConfig('/tmp/project')
    config.llmRetryBaseDelayMs = 1

    const result = await callModel({
      config,
      messages: [{ role: 'user', content: 'Hello' }],
      tools: []
    })

    expect(result).toEqual({ content: 'recovered', toolCalls: [] })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-retryable client errors', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }))
    vi.stubGlobal('fetch', fetch)
    const config = createDefaultConfig('/tmp/project')
    config.llmRetryBaseDelayMs = 1

    await expect(
      callModel({
        config,
        messages: [{ role: 'user', content: 'Hello' }],
        tools: []
      })
    ).rejects.toThrow('LLM request failed with HTTP 400: bad request')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('aborts requests that exceed the configured timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, init) => {
        const signal = (init as RequestInit).signal
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      })
    )

    const config = createDefaultConfig('/tmp/project')
    config.llmRequestTimeoutMs = 50
    config.llmRetryMaxAttempts = 1
    const request = callModel({
      config,
      messages: [{ role: 'user', content: 'Hello' }],
      tools: []
    })

    await vi.advanceTimersByTimeAsync(50)

    await expect(request).rejects.toThrow('LLM request failed: aborted')
  })
})
