import type { AppConfig } from '../config.js'

export type ModelUseCase =
  | 'chat'
  | 'planning'
  | 'coding'
  | 'summarization'
  | 'memory_extraction'
  | 'affect_analysis'
  | 'reflection'

export type ThinkingMode = 'auto' | 'on' | 'off'

export type ModelProviderName = 'openai-compatible' | 'deepseek'

export interface ModelCapabilities {
  contextWindowTokens: number
  supportsToolCalls: boolean
  supportsThinking: boolean
  supportsReasoningReplay: boolean
}

export interface ResolvedModelRoute {
  provider: ModelProviderName
  model: string
  useCase: ModelUseCase
  thinkingMode: ThinkingMode
  temperature: number
  capabilities: ModelCapabilities
}

export interface ModelContextInfo {
  provider: ModelProviderName
  model: string
  thinkingMode: ThinkingMode
  contextWindowTokens: number
}

export interface NormalizedUsage {
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cacheHitTokens?: number
  cacheMissTokens?: number
}

export interface ProviderMetadata {
  provider: ModelProviderName
  model: string
  thinking?: {
    enabled: boolean
    mode: ThinkingMode
    reasoningContent?: string
  }
  usage?: NormalizedUsage
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ModelToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatMessage {
  role: ChatRole
  content: string
  tool_call_id?: string
  tool_calls?: ModelToolCall[]
  providerMetadata?: ProviderMetadata
}

export interface CallModelInput {
  config: AppConfig
  messages: ChatMessage[]
  tools: unknown[]
  useCase?: ModelUseCase
}

export interface ModelResponse {
  content: string
  toolCalls: ModelToolCall[]
  providerMetadata?: ProviderMetadata
  usage?: NormalizedUsage
  route?: ResolvedModelRoute
}
