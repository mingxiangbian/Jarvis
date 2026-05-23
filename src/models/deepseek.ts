import { normalizeUsage } from './cost-tracker.js'
import {
  buildBaseRequest,
  type ChatCompletionRequestBody,
  type ChatCompletionResponse,
  type ProviderChatMessage,
  stripProviderMetadata
} from './openai-compatible.js'
import type { CallModelInput, ChatMessage, ModelResponse, ResolvedModelRoute } from './types.js'

export function buildDeepSeekRequest(input: CallModelInput, route: ResolvedModelRoute): ChatCompletionRequestBody {
  const body = buildBaseRequest(input, route, input.messages.map((message) => toDeepSeekMessage(message, route)))
  if (route.thinkingMode === 'off') {
    body.thinking = { type: 'disabled' }
  }
  return body
}

export function parseDeepSeekResponse(data: ChatCompletionResponse, route: ResolvedModelRoute): ModelResponse {
  const message = data.choices?.[0]?.message
  const reasoningContent = message?.reasoning_content ?? undefined
  const usage = normalizeUsage(data.usage)
  const providerMetadata =
    reasoningContent !== undefined || usage !== undefined
      ? {
          provider: 'deepseek' as const,
          model: route.model,
          ...(reasoningContent !== undefined
            ? {
                thinking: {
                  enabled: route.thinkingMode !== 'off',
                  mode: route.thinkingMode,
                  reasoningContent
                }
              }
            : {}),
          ...(usage !== undefined ? { usage } : {})
        }
      : undefined

  return {
    content: message?.content ?? '',
    toolCalls: message?.tool_calls ?? [],
    ...(providerMetadata !== undefined ? { providerMetadata } : {}),
    ...(usage !== undefined ? { usage } : {})
  }
}

function toDeepSeekMessage(message: ChatMessage, route: ResolvedModelRoute): ProviderChatMessage {
  const outbound = stripProviderMetadata(message)
  const reasoningContent = message.providerMetadata?.thinking?.reasoningContent
  if (
    route.thinkingMode !== 'off' &&
    message.role === 'assistant' &&
    message.providerMetadata?.provider === 'deepseek' &&
    reasoningContent !== undefined
  ) {
    outbound.reasoning_content = reasoningContent
  }
  return outbound
}
