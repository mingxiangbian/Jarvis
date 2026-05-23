import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/config.js'
import { contextInfoForRoute, resolveModelRoute } from '../src/models/provider-router.js'

describe('model router', () => {
  it('routes interactive work to the strong DeepSeek model', () => {
    const config = createDefaultConfig('/tmp/project')
    config.model.baseUrl = 'https://api.deepseek.com'
    config.model.provider = 'deepseek'
    config.model.model = 'deepseek-v4-pro'
    config.model.strongModel = 'deepseek-v4-pro'
    config.model.cheapModel = 'deepseek-v4-flash'
    config.model.thinkingMode = 'auto'

    for (const useCase of ['chat', 'planning', 'coding', 'reflection'] as const) {
      const route = resolveModelRoute(config, useCase)

      expect(route.provider).toBe('deepseek')
      expect(route.model).toBe('deepseek-v4-pro')
      expect(route.thinkingMode).toBe('auto')
      expect(route.capabilities.contextWindowTokens).toBe(1_048_576)
    }
  })

  it('routes lightweight background work to the cheap model with thinking disabled', () => {
    const config = createDefaultConfig('/tmp/project')
    config.model.baseUrl = 'https://api.deepseek.com'
    config.model.provider = 'deepseek'
    config.model.model = 'deepseek-v4-pro'
    config.model.strongModel = 'deepseek-v4-pro'
    config.model.cheapModel = 'deepseek-v4-flash'
    config.model.thinkingMode = 'on'

    for (const useCase of ['summarization', 'memory_extraction', 'affect_analysis'] as const) {
      const route = resolveModelRoute(config, useCase)

      expect(route.provider).toBe('deepseek')
      expect(route.model).toBe('deepseek-v4-flash')
      expect(route.thinkingMode).toBe('off')
      expect(route.temperature).toBe(0)
    }
  })

  it('falls back to the app context window for unknown OpenAI-compatible models', () => {
    const config = createDefaultConfig('/tmp/project')
    config.model.baseUrl = 'https://api.example.com/v1'
    config.model.model = 'custom-model'
    config.model.strongModel = 'custom-model'
    config.model.cheapModel = 'custom-model'
    config.contextWindowTokens = 123_456

    const route = resolveModelRoute(config, 'chat')

    expect(route.provider).toBe('openai-compatible')
    expect(route.capabilities.contextWindowTokens).toBe(123_456)
  })

  it('returns stable context info for the active interactive route', () => {
    const config = createDefaultConfig('/tmp/project')
    config.model.baseUrl = 'https://api.deepseek.com'
    config.model.provider = 'deepseek'
    config.model.model = 'deepseek-v4-pro'
    config.model.strongModel = 'deepseek-v4-pro'
    config.model.cheapModel = 'deepseek-v4-flash'

    expect(contextInfoForRoute(config, 'chat')).toEqual({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      thinkingMode: 'auto',
      contextWindowTokens: 1_048_576
    })
  })
})
