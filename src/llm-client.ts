import type { AppConfig } from './config.js'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: ChatRole
  content: string
  tool_call_id?: string
  tool_calls?: ModelToolCall[]
}

export interface ModelToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface CallModelInput {
  config: AppConfig
  messages: ChatMessage[]
  tools: unknown[]
}

export interface ModelResponse {
  content: string
  toolCalls: ModelToolCall[]
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: ModelToolCall[]
    }
  }>
}

export async function callModel(input: CallModelInput): Promise<ModelResponse> {
  const maxAttempts = Math.max(1, input.config.llmRetryMaxAttempts)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await requestCompletion(input)
      if (response.ok) {
        const data = (await response.json()) as ChatCompletionResponse
        const message = data.choices?.[0]?.message

        return {
          content: message?.content ?? '',
          toolCalls: message?.tool_calls ?? []
        }
      }

      if (isRetryableStatus(response.status) && attempt < maxAttempts) {
        await waitForRetry(input.config.llmRetryBaseDelayMs, attempt)
        continue
      }

      throw new Error(`LLM request failed with HTTP ${response.status}: ${await response.text()}`)
    } catch (error) {
      if (isFormattedLlmError(error)) {
        throw error
      }

      if (attempt < maxAttempts) {
        await waitForRetry(input.config.llmRetryBaseDelayMs, attempt)
        continue
      }

      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`LLM request failed: ${message}`)
    }
  }

  throw new Error('LLM request failed')
}

async function requestCompletion(input: CallModelInput): Promise<Response> {
  const body: {
    model: string
    temperature: number
    max_tokens: number
    chat_template_kwargs: { enable_thinking: boolean }
    messages: ChatMessage[]
    tools?: unknown[]
    tool_choice?: 'auto'
  } = {
    model: input.config.model.model,
    temperature: input.config.model.temperature,
    max_tokens: 4096,
    chat_template_kwargs: { enable_thinking: false },
    messages: input.messages
  }

  if (input.tools.length > 0) {
    body.tools = input.tools
    body.tool_choice = 'auto'
  }

  return fetch(`${input.config.model.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(input.config.llmRequestTimeoutMs),
    body: JSON.stringify(body)
  })
}

function isRetryableStatus(status: number): boolean {
  return status >= 500
}

function isFormattedLlmError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('LLM request failed with HTTP ')
}

function waitForRetry(baseDelayMs: number, attempt: number): Promise<void> {
  const delayMs = Math.max(0, baseDelayMs) * 2 ** (attempt - 1)
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}
