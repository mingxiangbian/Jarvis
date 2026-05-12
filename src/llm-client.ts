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
  const response = await fetch(`${input.config.model.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.config.model.model,
      temperature: input.config.model.temperature,
      messages: input.messages,
      tools: input.tools,
      tool_choice: 'auto'
    })
  })

  if (!response.ok) {
    throw new Error(`LLM request failed with HTTP ${response.status}: ${await response.text()}`)
  }

  const data = (await response.json()) as ChatCompletionResponse
  const message = data.choices?.[0]?.message

  return {
    content: message?.content ?? '',
    toolCalls: message?.tool_calls ?? []
  }
}
