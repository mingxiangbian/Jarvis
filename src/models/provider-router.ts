import type { AppConfig } from '../config.js'
import { capabilitiesForModel } from './model-capabilities.js'
import type { ModelContextInfo, ModelProviderName, ModelUseCase, ResolvedModelRoute } from './types.js'

const CHEAP_USE_CASES = new Set<ModelUseCase>(['summarization', 'memory_extraction', 'affect_analysis'])

export function resolveProvider(baseUrl: string, explicitProvider?: ModelProviderName): ModelProviderName {
  if (explicitProvider !== undefined) {
    return explicitProvider
  }

  try {
    const url = new URL(baseUrl)
    if (url.hostname === 'api.deepseek.com' || url.hostname.endsWith('.deepseek.com')) {
      return 'deepseek'
    }
  } catch {
    if (baseUrl.includes('deepseek.com')) {
      return 'deepseek'
    }
  }

  return 'openai-compatible'
}

export function resolveModelRoute(config: AppConfig, useCase: ModelUseCase): ResolvedModelRoute {
  const provider = resolveProvider(config.model.baseUrl, config.model.provider)
  const usesCheapModel = CHEAP_USE_CASES.has(useCase)
  const strongModel = config.model.strongModel || config.model.model
  const cheapModel = config.model.cheapModel || strongModel
  const model = usesCheapModel ? cheapModel : strongModel
  const thinkingMode = usesCheapModel ? 'off' : config.model.thinkingMode

  return {
    provider,
    model,
    useCase,
    thinkingMode,
    temperature: usesCheapModel ? 0 : config.model.temperature,
    capabilities: capabilitiesForModel(provider, model, config.contextWindowTokens)
  }
}

export function contextInfoForRoute(config: AppConfig, useCase: ModelUseCase): ModelContextInfo {
  const route = resolveModelRoute(config, useCase)
  return {
    provider: route.provider,
    model: route.model,
    thinkingMode: route.thinkingMode,
    contextWindowTokens: route.capabilities.contextWindowTokens
  }
}
