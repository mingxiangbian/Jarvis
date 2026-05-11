import type { z } from 'zod'
import type { AppConfig } from '../config.js'

export interface JsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface ToolContext {
  config: AppConfig
  trackedFiles: Set<string>
}

export interface ToolResult {
  ok: boolean
  content: string
  metadata?: Record<string, unknown>
}

export interface Tool<TArgs> {
  name: string
  description: string
  parameters: JsonSchema
  schema: z.ZodType<TArgs>
  isReadonly: boolean
  isDestructive: boolean
  isConcurrencySafe: boolean
  needsUserInteraction: boolean
  execute(args: TArgs, context: ToolContext): Promise<ToolResult>
}

export interface ToolCall {
  id: string
  name: string
  argumentsText: string
}
