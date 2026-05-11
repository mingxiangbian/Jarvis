export interface ModelConfig {
  baseUrl: string
  model: string
  temperature: number
}

export interface AppConfig {
  cwd: string
  model: ModelConfig
  maxToolCallsPerTurn: number
  readMaxInlineLines: number
  grepMaxMatches: number
  bashTimeoutMs: number
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
    readMaxInlineLines: 500,
    grepMaxMatches: 30,
    bashTimeoutMs: 120_000,
    writableRoots: [cwd],
    bashDenyPatterns: [
      /rm\s+-rf\s+\//,
      /mkfs\./,
      /dd\s+if=/,
      />\s*\/dev\/sd/,
      /curl\b.*\|\s*sh/,
      /:\(\)\s*\{\s*:\|:&\s*\};:/
    ]
  }
}
