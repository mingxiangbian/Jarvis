import type {
  CallModelInput,
  ChatMessage,
  ModelResponse,
  ModelToolCall,
  ResolvedModelRoute
} from './types.js'

export interface ProviderChatMessage {
  role: ChatMessage['role']
  content: string
  tool_call_id?: string
  tool_calls?: ModelToolCall[]
  reasoning_content?: string
}

export interface ChatCompletionRequestBody {
  model: string
  temperature: number
  max_tokens: number
  messages: ProviderChatMessage[]
  tools?: unknown[]
  tool_choice?: 'auto'
  thinking?: { type: 'disabled' }
}

export interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: ModelToolCall[]
    }
  }>
  usage?: unknown
}

export function buildOpenAICompatibleRequest(
  input: CallModelInput,
  route: ResolvedModelRoute
): ChatCompletionRequestBody {
  return buildBaseRequest(input, route, input.messages.map(stripProviderMetadata))
}

export function parseOpenAICompatibleResponse(
  data: ChatCompletionResponse,
  _route: ResolvedModelRoute
): ModelResponse {
  const message = data.choices?.[0]?.message
  return {
    content: message?.content ?? '',
    toolCalls: message?.tool_calls ?? []
  }
}

export function buildBaseRequest(
  input: CallModelInput,
  route: ResolvedModelRoute,
  messages: ProviderChatMessage[]
): ChatCompletionRequestBody {
  const body: ChatCompletionRequestBody = {
    model: route.model,
    temperature: route.temperature,
    max_tokens: 4096,
    messages
  }

  if (input.tools.length > 0) {
    body.tools = input.tools
    body.tool_choice = 'auto'
  }

  return body
}

export function stripProviderMetadata(message: ChatMessage): ProviderChatMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.tool_call_id !== undefined ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls !== undefined ? { tool_calls: message.tool_calls } : {})
  }
}
