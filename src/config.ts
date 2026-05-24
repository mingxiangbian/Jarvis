import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { resolveProvider } from './models/provider-router.js'
import type { ModelProviderName, ThinkingMode } from './models/types.js'

export type EvolutionReflectionMode = 'manual' | 'light' | 'off'

export interface ModelConfig {
  baseUrl: string
  model: string
  apiKey?: string
  temperature: number
  provider: ModelProviderName
  strongModel: string
  cheapModel: string
  thinkingMode: ThinkingMode
}

export interface FeatureFlags {
  bashEnabled: boolean
  webSearchEnabled: boolean
  mcpEnabled: boolean
}

export interface AppConfig {
  cwd: string
  memoryCwd: string
  model: ModelConfig
  features: FeatureFlags
  maxToolCallsPerTurn: number
  contextWindowTokens: number
  autoCompactThreshold: number
  snipThreshold: number
  microcompactThreshold: number
  collapseThreshold: number
  snipKeepRounds: number
  microcompactKeepRecentRounds: number
  userCyreneDir: string
  sessionResumeRecentMessages: number
  memoryAutoExtractEnabled: boolean
  evolutionEnabled: boolean
  evolutionReflectionMode: EvolutionReflectionMode
  memoryMaxLines: number
  memoryMaxLineLength: number
  readMaxInlineLines: number
  grepMaxMatches: number
  bashTimeoutMs: number
  llmRequestTimeoutMs: number
  llmRetryMaxAttempts: number
  llmRetryBaseDelayMs: number
  readableRoots: string[]
  writableRoots: string[]
  bashDenyPatterns: RegExp[]
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue
  }
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())
}

function parsePositiveIntEnv(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

function loadDotEnv(cwd: string): Record<string, string> {
  let currentDir = resolve(cwd)
  while (true) {
    try {
      return parseDotEnv(readFileSync(join(currentDir, '.env'), 'utf8'))
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) {
        throw error
      }
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      return {}
    }
    currentDir = parentDir
  }
}

function parseDotEnv(raw: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed)
    if (match === null) {
      continue
    }

    values[match[1]] = unquoteEnvValue(match[2].trim())
  }

  return values
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function envValue(dotEnv: Record<string, string>, name: string): string | undefined {
  return process.env[name] ?? dotEnv[name]
}

function optionalEnvValue(dotEnv: Record<string, string>, name: string): string | undefined {
  const value = envValue(dotEnv, name)
  return value?.trim() === '' ? undefined : value
}

function parseProvider(value: string | undefined): ModelProviderName | undefined {
  if (value === 'deepseek' || value === 'openai-compatible') {
    return value
  }
  return undefined
}

function parseThinkingMode(value: string | undefined): ThinkingMode {
  if (value === 'auto' || value === 'on' || value === 'off') {
    return value
  }
  return 'auto'
}

function parseEvolutionReflectionMode(value: string | undefined): EvolutionReflectionMode {
  if (value === 'manual' || value === 'light' || value === 'off') {
    return value
  }
  return 'manual'
}

export function createDefaultConfig(cwd: string): AppConfig {
  const dotEnv = loadDotEnv(cwd)
  const baseUrl = envValue(dotEnv, 'CYRENE_BASE_URL') ?? ''
  const model = envValue(dotEnv, 'CYRENE_MODEL') ?? ''
  const strongModel = optionalEnvValue(dotEnv, 'CYRENE_STRONG_MODEL') ?? model
  const cheapModel = optionalEnvValue(dotEnv, 'CYRENE_CHEAP_MODEL') ?? strongModel

  return {
    cwd,
    memoryCwd: cwd,
    model: {
      baseUrl,
      model,
      apiKey: optionalEnvValue(dotEnv, 'CYRENE_API_KEY'),
      temperature: 0,
      provider: resolveProvider(baseUrl, parseProvider(envValue(dotEnv, 'CYRENE_MODEL_PROVIDER'))),
      strongModel,
      cheapModel,
      thinkingMode: parseThinkingMode(envValue(dotEnv, 'CYRENE_THINKING_MODE'))
    },
    features: {
      bashEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_ENABLE_BASH'), true),
      webSearchEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_ENABLE_WEB_SEARCH'), true),
      mcpEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_ENABLE_MCP'), false)
    },
    maxToolCallsPerTurn: 10,
    contextWindowTokens: 256_000,
    autoCompactThreshold: 0.7,
    snipThreshold: 0.4,
    microcompactThreshold: 0.5,
    collapseThreshold: 0.6,
    snipKeepRounds: 15,
    microcompactKeepRecentRounds: 5,
    userCyreneDir: join(homedir(), '.cyrene'),
    sessionResumeRecentMessages: 40,
    memoryAutoExtractEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_AUTO_EXTRACT'), true),
    evolutionEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_EVOLUTION_ENABLED'), false),
    evolutionReflectionMode: parseEvolutionReflectionMode(envValue(dotEnv, 'CYRENE_EVOLUTION_REFLECTION_MODE')),
    memoryMaxLines: 200,
    memoryMaxLineLength: 150,
    readMaxInlineLines: 500,
    grepMaxMatches: 30,
    bashTimeoutMs: 120_000,
    llmRequestTimeoutMs: 180_000,
    llmRetryMaxAttempts: 3,
    llmRetryBaseDelayMs: 1_000,
    readableRoots: [cwd],
    writableRoots: [cwd],
    bashDenyPatterns: [
      /\brm\b(?=.*(?:^|\s)-[A-Za-z]*r)(?=.*(?:^|\s)-[A-Za-z]*f).*\s(?:--\s+)?\//,
      /mkfs\./,
      /\bdd\b(?=.*\bof=\/dev\/sd[a-z]?\b)/,
      />\s*\/dev\/sd/,
      /\b(?:curl|wget)\b.*\|\s*(?:ba)?sh\b/,
      /:\(\)\s*\{\s*:\|:&\s*\};:/
    ]
  }
}
