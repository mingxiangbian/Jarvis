import type { ModelCapabilities, ModelProviderName } from './types.js'

const DEFAULT_CAPABILITIES: Omit<ModelCapabilities, 'contextWindowTokens'> = {
  supportsToolCalls: true,
  supportsThinking: false,
  supportsReasoningReplay: false
}

const DEEPSEEK_V4_PRO_CAPABILITIES: ModelCapabilities = {
  contextWindowTokens: 1_048_576,
  supportsToolCalls: true,
  supportsThinking: true,
  supportsReasoningReplay: true
}

const DEEPSEEK_V4_FLASH_CAPABILITIES: ModelCapabilities = {
  contextWindowTokens: 1_048_576,
  supportsToolCalls: true,
  supportsThinking: true,
  supportsReasoningReplay: true
}

export function capabilitiesForModel(
  provider: ModelProviderName,
  model: string,
  fallbackContextWindowTokens: number
): ModelCapabilities {
  if (provider === 'deepseek') {
    if (model === 'deepseek-v4-pro') {
      return DEEPSEEK_V4_PRO_CAPABILITIES
    }
    if (model === 'deepseek-v4-flash') {
      return DEEPSEEK_V4_FLASH_CAPABILITIES
    }
  }

  return {
    ...DEFAULT_CAPABILITIES,
    contextWindowTokens: fallbackContextWindowTokens
  }
}
