import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ModelConfig {
  baseUrl: string
  model: string
  temperature: number
}

export interface AppConfig {
  cwd: string
  model: ModelConfig
  maxToolCallsPerTurn: number
  contextWindowTokens: number
  autoCompactThreshold: number
  snipThreshold: number
  microcompactThreshold: number
  collapseThreshold: number
  snipKeepRounds: number
  microcompactKeepRecentRounds: number
  userCcLocalDir: string
  dailyCompactThreshold: number
  dailyLoadLines: number
  memoryMaxLines: number
  memoryMaxLineLength: number
  readMaxInlineLines: number
  grepMaxMatches: number
  bashTimeoutMs: number
  llmRequestTimeoutMs: number
  llmRetryMaxAttempts: number
  llmRetryBaseDelayMs: number
  writableRoots: string[]
  bashDenyPatterns: RegExp[]
}

export function createDefaultConfig(cwd: string): AppConfig {
  return {
    cwd,
    model: {
      baseUrl: process.env.CC_LOCAL_BASE_URL ?? 'http://127.0.0.1:8080/v1',
      model: process.env.CC_LOCAL_MODEL ?? 'Qwen3.5-9B-MLX-4bit',
      temperature: 0
    },
    maxToolCallsPerTurn: 10,
    contextWindowTokens: 256_000,
    autoCompactThreshold: 0.7,
    snipThreshold: 0.4,
    microcompactThreshold: 0.5,
    collapseThreshold: 0.6,
    snipKeepRounds: 15,
    microcompactKeepRecentRounds: 5,
    userCcLocalDir: join(homedir(), '.cc-local'),
    dailyCompactThreshold: 500,
    dailyLoadLines: 200,
    memoryMaxLines: 200,
    memoryMaxLineLength: 150,
    readMaxInlineLines: 500,
    grepMaxMatches: 30,
    bashTimeoutMs: 120_000,
    llmRequestTimeoutMs: 180_000,
    llmRetryMaxAttempts: 3,
    llmRetryBaseDelayMs: 1_000,
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
