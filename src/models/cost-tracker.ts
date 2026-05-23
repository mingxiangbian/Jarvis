import type { NormalizedUsage } from './types.js'

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function normalizeUsage(raw: unknown): NormalizedUsage | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined
  }

  const usage = raw as {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    prompt_cache_hit_tokens?: unknown
    prompt_cache_miss_tokens?: unknown
    completion_tokens_details?: { reasoning_tokens?: unknown }
  }
  const normalized: NormalizedUsage = {
    promptTokens: numberField(usage.prompt_tokens),
    completionTokens: numberField(usage.completion_tokens),
    reasoningTokens: numberField(usage.completion_tokens_details?.reasoning_tokens),
    cacheHitTokens: numberField(usage.prompt_cache_hit_tokens),
    cacheMissTokens: numberField(usage.prompt_cache_miss_tokens)
  }

  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined
}
