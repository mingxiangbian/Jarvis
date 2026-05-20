import type { AppConfig } from './config.js'
import { appendDaily } from './daily-logger.js'
import type { CallModelInput, ModelResponse } from './llm-client.js'

export interface DailySummaryPromptInput {
  userPrompt: string
  finalText: string
}

export interface MaybeAppendDailySummaryInput extends DailySummaryPromptInput {
  cwd: string
  config: AppConfig
  callModel: (input: CallModelInput) => Promise<ModelResponse>
  now?: Date
  appendDaily?: (cwd: string, chunks: string[]) => Promise<void>
}

export interface DailySummaryResponse {
  shouldRemember: boolean
  summary: string
}

const durableSignalPatterns = [
  /remember|prefer|preference|default|rule|constraint|decision|decide|design|architecture|root cause|follow[- ]?up|next step|workflow|memory|context|agent behavior|configuration/i,
  /记住|偏好|默认|规则|约束|决定|设计|架构|根因|原因|待办|下一步|记忆|上下文|工具调用|文件修改|工作流/
]

const durableSummaryPatterns = [
  /user prefers|preference|decision|root cause|follow[- ]?up|next step|project fact|workflow|memory|context|should|must|default/i,
  /用户.*(希望|偏好|要求)|决定|根因|原因|待办|下一步|项目事实|工作流|记忆|上下文|应该|必须|默认/
]

const operationalPatterns = [
  /^\s*\[?\d{0,4}[-:\d\s]*\]?\s*(glob|grep|file_read|file_write|file_edit|bash|web_search)\s*->/i,
  /\b(glob|grep|file_read|file_write|file_edit|bash|web_search)\s*->\s*(ok|failed)\b/i,
  /^edited\s+\S+/i,
  /^(modified|changed|updated)\s+\S+/i,
  /\b(edited|modified|changed|updated)\s+[\w./-]+\.[\w-]+\b/i,
  /^wrote\s+\S+/i,
  /^ran\s+(rg|grep|glob|npm|git|bash)\b/i
]

const genericSummaries = new Set([
  'user asked a question.',
  'the user asked a question.',
  'assistant answered the question.',
  'the assistant answered the question.'
])

export function hasDailyMemorySignal(userPrompt: string, finalText: string): boolean {
  const combined = `${userPrompt}\n${finalText}`.trim()
  if (combined.length < 40) {
    return false
  }

  return durableSignalPatterns.some((pattern) => pattern.test(combined))
}

export function buildDailySummaryPrompt(input: DailySummaryPromptInput): string {
  return `Review this completed agent turn and decide whether it contains durable context worth saving to short-term daily memory.

Return only JSON in this shape:
{
  "shouldRemember": true,
  "summary": "single sentence durable context"
}

Rules:
- Prefer false when the turn is short, ordinary, or only confirms progress.
- Remember user preferences, project decisions, root causes, unresolved follow-ups, reusable project facts, and workflow rules.
- Do not summarize routine tool calls.
- Do not write file-edit logs.
- Mention tools or files only when their outcome is the durable context.
- Keep the summary as one concise paragraph.

User prompt:
${input.userPrompt}

Assistant final answer:
${input.finalText}`
}

export function parseDailySummaryResponse(content: string): DailySummaryResponse | null {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }

    const value = parsed as Record<string, unknown>
    if (typeof value.shouldRemember !== 'boolean' || typeof value.summary !== 'string') {
      return null
    }

    return {
      shouldRemember: value.shouldRemember,
      summary: value.summary
    }
  } catch {
    return null
  }
}

export function validateDailySummary(summary: string, config: AppConfig): boolean {
  const normalized = summary.trim().replace(/\s+/g, ' ')
  if (normalized.length < 20 || normalized.length > config.dailySummaryMaxLength) {
    return false
  }

  if (normalized.includes('\n') || genericSummaries.has(normalized.toLowerCase())) {
    return false
  }

  if (operationalPatterns.some((pattern) => pattern.test(normalized))) {
    return false
  }

  return durableSummaryPatterns.some((pattern) => pattern.test(normalized))
}

export async function maybeAppendDailySummary(input: MaybeAppendDailySummaryInput): Promise<boolean> {
  if (!hasDailyMemorySignal(input.userPrompt, input.finalText)) {
    return false
  }

  let parsed: DailySummaryResponse | null
  try {
    const response = await input.callModel({
      config: input.config,
      messages: [{ role: 'user', content: buildDailySummaryPrompt(input) }],
      tools: []
    })
    parsed = parseDailySummaryResponse(response.content)
  } catch {
    return false
  }

  if (parsed === null || !parsed.shouldRemember || !validateDailySummary(parsed.summary, input.config)) {
    return false
  }

  await (input.appendDaily ?? appendDaily)(input.cwd, [formatDailySummaryEntry(input.now ?? new Date(), parsed.summary)])
  return true
}

function formatDailySummaryEntry(date: Date, summary: string): string {
  return `[${formatDailyTime(date)}] ${summary.trim().replace(/\s+/g, ' ')}`
}

function formatDailyTime(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}
