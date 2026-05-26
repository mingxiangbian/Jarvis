import { randomUUID } from 'node:crypto'
import { ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import { type CodexMemoryCandidateInput, proposeCodexMemoryCandidate } from './memory-propose.js'
import { identifyCodexProject } from './project-id.js'
import { redactReviewText, mergeRedactionCounts } from './review-redaction.js'
import { appendCodexReviewSummary } from './review-summary-store.js'
import { recentTranscriptMessages, type TranscriptMessage } from './transcript.js'
import type { AppConfig } from '../config.js'
import type { CallModelInput, ModelResponse } from '../llm-client.js'

export type CodexReviewSummaryResult =
  | { action: 'noop'; reason: string }
  | { action: 'summary'; summaryId: string; memoryRoot: string; candidateIds: [] }
  | { action: 'pending'; summaryId: string; memoryRoot: string; candidateIds: string[] }
  | { action: 'summary_failed'; summaryId: string; memoryRoot: string; reason: string }

export interface RunCodexReviewSummaryInput {
  cwd: string
  sessionId?: string
  turnId?: string
  messages: TranscriptMessage[]
  config: AppConfig
  callModel: (input: CallModelInput) => Promise<ModelResponse>
  now?: string
  signal?: AbortSignal
}

interface ParsedReviewSummary {
  summary: string
  candidates: unknown[]
}

const DOMAINS = ['procedural', 'project', 'preference', 'relationship', 'affective', 'episodic'] as const
const TYPES = [
  'procedural_rule',
  'project_fact',
  'user_preference',
  'relationship_signal',
  'affective_state',
  'event_memory'
] as const
const STRENGTHS = ['hard', 'soft', 'observed'] as const
const SCOPES = ['global', 'project', 'thread'] as const
const SOURCES = ['user_explicit', 'assistant_observed', 'inferred', 'imported'] as const

const FAILED_SUMMARY = 'Codex review summary failed; no transcript content persisted.'

export async function runCodexReviewSummary(input: RunCodexReviewSummaryInput): Promise<CodexReviewSummaryResult> {
  const window = recentTranscriptMessages(input.messages, 40)
  if (window.length === 0) {
    return { action: 'noop', reason: 'No transcript messages to summarize.' }
  }

  const project = await identifyCodexProject(input.cwd)
  const memoryRoot = await ensureCodexProjectMemoryRoot(project.projectId)
  const summaryId = randomUUID()
  const runId = [input.sessionId, input.turnId].filter(Boolean).join(':') || summaryId
  const createdAt = input.now ?? new Date().toISOString()
  const inputRedaction = redactReviewText(formatMessages(window))
  const model = { useCase: 'memory_extraction' as const, model: input.config.model.cheapModel || input.config.model.strongModel }

  try {
    const response = await input.callModel({
      config: input.config,
      messages: [{ role: 'user', content: buildCodexReviewSummaryPrompt(inputRedaction.text) }],
      tools: [],
      useCase: 'memory_extraction',
      signal: input.signal
    })
    const parsed = parseReviewSummaryResponse(response.content)
    const outputRedaction = createOutputRedactor()
    const summary = outputRedaction.redact(parsed.summary)
    const candidateIds: string[] = []

    for (const candidate of parsed.candidates) {
      const safeCandidate = redactCandidate(candidate, runId, summary, outputRedaction)
      if (safeCandidate === undefined) {
        continue
      }

      const result = await proposeCodexMemoryCandidate({
        cwd: input.cwd,
        candidate: safeCandidate,
        now: input.now
      })
      if (result.result.action === 'pending') {
        candidateIds.push(result.result.candidateId)
      }
    }

    await appendCodexReviewSummary(memoryRoot, {
      id: summaryId,
      runId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      createdAt,
      status: 'ok',
      summary,
      redaction: { input: inputRedaction.counts, output: outputRedaction.counts },
      model,
      candidateIds
    })

    if (candidateIds.length > 0) {
      return { action: 'pending', summaryId, memoryRoot, candidateIds }
    }
    return { action: 'summary', summaryId, memoryRoot, candidateIds: [] }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await appendCodexReviewSummary(memoryRoot, {
      id: summaryId,
      runId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      createdAt,
      status: 'failed',
      summary: FAILED_SUMMARY,
      redaction: { input: inputRedaction.counts, output: {} },
      model,
      candidateIds: [],
      failureReason: reason.slice(0, 500)
    })
    return { action: 'summary_failed', summaryId, memoryRoot, reason: reason.slice(0, 500) }
  }
}

export function buildCodexReviewSummaryPrompt(redactedTranscript: string): string {
  return [
    'Return JSON only with this shape: {"summary":"review-safe summary","candidates":[]}.',
    'Prefer no candidates over weak candidates.',
    'Use only the redacted transcript text below.',
    'Do not store secrets, credentials, raw quotes, psychological diagnoses, or assistant-only suggestions.',
    'Memory candidates must match the existing memory candidate schema.',
    'Candidates may include domain, type, strength, scope, content, normalizedKey, source, scores, evidence, and tags.',
    '',
    'Redacted transcript:',
    redactedTranscript
  ].join('\n')
}

export function parseReviewSummaryResponse(content: string): ParsedReviewSummary {
  const objectText = extractJsonObject(content)
  const parsed = JSON.parse(objectText) as unknown
  if (!isRecord(parsed) || typeof parsed.summary !== 'string' || parsed.summary.trim() === '') {
    throw new Error('Review summary response is missing summary.')
  }

  return {
    summary: parsed.summary,
    candidates: Array.isArray(parsed.candidates) ? parsed.candidates : []
  }
}

function formatMessages(messages: TranscriptMessage[]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join('\n')
}

function redactCandidate(
  value: unknown,
  runId: string,
  redactedSummary: string,
  redactor: ReturnType<typeof createOutputRedactor>
): CodexMemoryCandidateInput | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const domain = parseEnum(value.domain, DOMAINS)
  const type = parseEnum(value.type, TYPES)
  const content = parseString(value.content)
  if (domain === undefined || type === undefined || content === undefined) {
    return undefined
  }

  const candidate = {
    domain,
    type,
    strength: parseEnum(value.strength, STRENGTHS),
    scope: parseEnum(value.scope, SCOPES),
    content: redactor.redact(content),
    normalizedKey: redactOptionalString(value.normalizedKey, redactor),
    source: parseEnum(value.source, SOURCES),
    evidence: redactEvidence(value.evidence, runId, redactedSummary, redactor),
    scores: parseScores(value.scores),
    tags: redactTags(value.tags, redactor)
  }

  return candidate as unknown as CodexMemoryCandidateInput
}

function redactEvidence(
  value: unknown,
  runId: string,
  redactedSummary: string,
  redactor: ReturnType<typeof createOutputRedactor>
): Array<{ runId?: string; summary?: string; quote?: string }> {
  const evidence = Array.isArray(value)
    ? value.flatMap((entry) => {
        if (!isRecord(entry)) {
          return []
        }
        const summary = redactOptionalString(entry.summary, redactor)
        const quote = redactOptionalString(entry.quote, redactor)
        if (summary === undefined && quote === undefined) {
          return []
        }
        return [{ runId: parseString(entry.runId) ?? runId, summary, quote }]
      })
    : []

  if (evidence.length > 0) {
    return evidence
  }
  return [{ runId, summary: redactedSummary }]
}

function redactTags(value: unknown, redactor: ReturnType<typeof createOutputRedactor>): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.flatMap((entry) => {
    const tag = parseString(entry)
    return tag === undefined ? [] : [redactor.redact(tag)]
  })
}

function redactOptionalString(value: unknown, redactor: ReturnType<typeof createOutputRedactor>): string | undefined {
  const text = parseString(value)
  return text === undefined ? undefined : redactor.redact(text)
}

function parseScores(value: unknown): CodexMemoryCandidateInput['scores'] {
  if (!isRecord(value)) {
    return undefined
  }

  const scores: Record<string, number> = {}
  for (const key of ['evidenceStrength', 'stability', 'usefulness', 'safety', 'sensitivity']) {
    const score = value[key]
    if (typeof score === 'number' && Number.isFinite(score)) {
      scores[key] = score
    }
  }
  return Object.keys(scores).length > 0 ? scores : undefined
}

function extractJsonObject(content: string): string {
  const start = content.indexOf('{')
  if (start === -1) {
    throw new Error('Review summary response did not contain JSON.')
  }

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < content.length; index += 1) {
    const char = content[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return content.slice(start, index + 1)
      }
    }
  }

  throw new Error('Review summary response JSON was incomplete.')
}

function createOutputRedactor(): { counts: Record<string, number>; redact: (text: string) => string } {
  return {
    counts: {},
    redact(text: string): string {
      const result = redactReviewText(text)
      this.counts = mergeRedactionCounts(this.counts, result.counts)
      return result.text
    }
  }
}

function parseEnum<T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T[number] : undefined
}

function parseString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
