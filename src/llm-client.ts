import type { AppConfig } from './config.js'
import { buildDeepSeekRequest, parseDeepSeekResponse } from './models/deepseek.js'
import {
  buildOpenAICompatibleRequest,
  parseOpenAICompatibleResponse,
  type ChatCompletionRequestBody,
  type ChatCompletionResponse
} from './models/openai-compatible.js'
import { resolveModelRoute } from './models/provider-router.js'
import type {
  CallModelInput,
  ChatMessage,
  ChatRole,
  ModelResponse,
  ModelToolCall,
  ModelUseCase
} from './models/types.js'

export type { CallModelInput, ChatMessage, ChatRole, ModelResponse, ModelToolCall, ModelUseCase }

export async function callModel(input: CallModelInput): Promise<ModelResponse> {
  const useCase = input.useCase ?? 'chat'
  const route = resolveModelRoute(input.config, useCase)
  const body =
    route.provider === 'deepseek'
      ? buildDeepSeekRequest(input, route)
      : buildOpenAICompatibleRequest(input, route)
  const maxAttempts = Math.max(1, input.config.llmRetryMaxAttempts)

  validateModelConfig(input.config, route.model)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await requestCompletion(input.config, body)
      if (response.ok) {
        const data = (await response.json()) as ChatCompletionResponse
        return route.provider === 'deepseek'
          ? parseDeepSeekResponse(data, route)
          : parseOpenAICompatibleResponse(data, route)
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

async function requestCompletion(config: AppConfig, body: ChatCompletionRequestBody): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.model.apiKey?.trim()) {
    headers.authorization = `Bearer ${config.model.apiKey}`
  }

  return fetch(`${config.model.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(config.llmRequestTimeoutMs),
    body: JSON.stringify(body)
  })
}

function validateModelConfig(config: AppConfig, routeModel: string): void {
  const missing: string[] = []
  if (config.model.baseUrl.trim() === '') {
    missing.push('CYRENE_BASE_URL')
  }
  if (config.model.model.trim() === '' || routeModel.trim() === '') {
    missing.push('CYRENE_MODEL')
  }
  if (missing.length > 0) {
    throw new Error(`Model config is incomplete: set ${missing.join(' and ')}.`)
  }
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
