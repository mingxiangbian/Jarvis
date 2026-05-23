import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig } from '../src/config.js'
import { callModel, type ChatMessage } from '../src/llm-client.js'

function deepSeekConfig() {
  const config = createDefaultConfig('/tmp/project')
  config.model.baseUrl = 'https://api.deepseek.com'
  config.model.model = 'deepseek-v4-pro'
  config.model.provider = 'deepseek'
  config.model.strongModel = 'deepseek-v4-pro'
  config.model.cheapModel = 'deepseek-v4-flash'
  config.model.thinkingMode = 'auto'
  return config
}

describe('DeepSeek provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the strong model for chat requests', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetch)

    await callModel({
      config: deepSeekConfig(),
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      useCase: 'chat'
    })

    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>
    expect(body.model).toBe('deepseek-v4-pro')
    expect(body).not.toHaveProperty('thinking')
  })

  it('uses the cheap model and disables thinking for summarization', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'summary' } }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetch)
    const config = deepSeekConfig()
    config.model.thinkingMode = 'on'

    await callModel({
      config,
      messages: [{ role: 'user', content: 'summarize' }],
      tools: [],
      useCase: 'summarization'
    })

    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>
    expect(body.model).toBe('deepseek-v4-flash')
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.temperature).toBe(0)
  })

  it('replays DeepSeek reasoning content for tool-call turns when thinking is enabled', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetch)
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'glob', arguments: '{"pattern":"*.ts"}' }
          }
        ],
        providerMetadata: {
          provider: 'deepseek',
          model: 'deepseek-v4-pro',
          thinking: {
            enabled: true,
            mode: 'auto',
            reasoningContent: 'Need to inspect matching files.'
          }
        }
      }
    ]

    await callModel({
      config: deepSeekConfig(),
      messages,
      tools: [],
      useCase: 'chat'
    })

    const body = JSON.parse((fetch.mock.calls[0]?.[1] as RequestInit).body as string) as {
      messages: Array<Record<string, unknown>>
    }
    expect(body.messages[0]).toMatchObject({
      role: 'assistant',
      reasoning_content: 'Need to inspect matching files.'
    })
    expect(body.messages[0]).not.toHaveProperty('providerMetadata')
  })

  it('normalizes reasoning content and usage from DeepSeek responses', async () => {
    const toolCalls = [
      {
        id: 'call-1',
        type: 'function' as const,
        function: { name: 'grep', arguments: '{"pattern":"foo"}' }
      }
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  reasoning_content: 'Search before editing.',
                  tool_calls: toolCalls
                }
              }
            ],
            usage: {
              prompt_tokens: 11,
              completion_tokens: 7,
              completion_tokens_details: { reasoning_tokens: 3 },
              prompt_cache_hit_tokens: 5,
              prompt_cache_miss_tokens: 6
            }
          }),
          { status: 200 }
        )
      )
    )

    const result = await callModel({
      config: deepSeekConfig(),
      messages: [{ role: 'user', content: 'find foo' }],
      tools: [],
      useCase: 'chat'
    })

    expect(result.content).toBe('')
    expect(result.toolCalls).toEqual(toolCalls)
    expect(result.providerMetadata).toEqual({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      thinking: {
        enabled: true,
        mode: 'auto',
        reasoningContent: 'Search before editing.'
      },
      usage: {
        promptTokens: 11,
        completionTokens: 7,
        reasoningTokens: 3,
        cacheHitTokens: 5,
        cacheMissTokens: 6
      }
    })
  })
})
