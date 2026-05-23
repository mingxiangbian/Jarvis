import type { ChatMessage } from '../llm-client.js'
import type {
  ModelContextInfo,
  ModelProviderName,
  ModelUseCase,
  NormalizedUsage,
  ThinkingMode
} from '../models/types.js'

export type TraceMode = 'cli' | 'repl' | 'web'
export type TraceStatus = 'ok' | 'error'

export interface TraceInput {
  runId: string
  mode: TraceMode
  cwd: string
  workspaceId?: string
  workspacePath?: string
  sessionId?: string
  startedAt: string
  userMessage: {
    role: 'user'
    content: string
  }
  modelContext?: ModelContextInfo
}

export interface TraceMessageLine {
  at: string
  message: ChatMessage
}

export interface TraceModelCallLine {
  callId: string
  at: string
  useCase: ModelUseCase
  provider?: ModelProviderName
  model?: string
  thinkingMode?: ThinkingMode
  messageCount: number
  toolCount: number
  durationMs: number
  ok: boolean
  usage?: NormalizedUsage
  error?: string
}

export interface TraceToolCallLine {
  toolCallId: string
  at: string
  name: string
  inputSummary: string
  outputSummary?: string
  durationMs?: number
  ok?: boolean
  error?: string
}

export interface TraceMetrics {
  runId: string
  status: TraceStatus
  startedAt: string
  finishedAt: string
  durationMs: number
  modelCallCount: number
  toolCallCount: number
  errorCount: number
  finalTextLength: number
}
