import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { appendMemoryEvent, upsertPendingMemory } from '../../memory/memory-store.js'
import type { MemoryType, PendingMemory } from '../../memory/types.js'
import { controlError, controlOk, isObject, writeControlJson } from './types.js'

type AffectCorrectionTarget = 'affect' | 'relationship' | 'strategy'

export interface AffectApiContext {
  memoryCwd: string
}

export async function createAffectCorrection(
  request: IncomingMessage,
  response: ServerResponse,
  context: AffectApiContext,
  readRequestBody: (request: IncomingMessage) => Promise<string>
): Promise<void> {
  let body: unknown
  try {
    body = JSON.parse(await readRequestBody(request))
  } catch (error) {
    writeControlJson(
      response,
      isRequestBodyTooLargeError(error) ? 413 : 400,
      controlError(isRequestBodyTooLargeError(error) ? 'Request body too large.' : 'Invalid JSON body.')
    )
    return
  }

  const parsed = parseCorrectionInput(body)
  if (!parsed.ok) {
    writeControlJson(response, 400, controlError(parsed.error))
    return
  }

  const nowDate = new Date()
  const now = nowDate.toISOString()
  const expiresAt = new Date(nowDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const candidate: PendingMemory = {
    id: `affect-correction-${randomUUID()}`,
    domain: parsed.target === 'affect' ? 'affective' : 'relationship',
    type: memoryTypeForTarget(parsed.target),
    strength: 'session',
    scope: 'session',
    status: 'pending',
    content: `User corrected Cyrene interpretation: ${parsed.correction}`,
    normalizedKey: `web-affect-correction:${parsed.target}:${normalizeKey(parsed.correction)}`,
    evidence: [{
      summary: parsed.correction,
      traceRefs: parsed.runId === undefined ? undefined : [parsed.runId]
    }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.7,
      stability: 0.3,
      usefulness: 0.5,
      safety: 0.95,
      sensitivity: 0.2
    },
    seenCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    expiresAt,
    tags: ['web-affect-correction', parsed.target],
    ...(parsed.sessionId === undefined ? {} : { conflictsWith: [`session:${parsed.sessionId}`] })
  }

  const merged = await upsertPendingMemory(context.memoryCwd, candidate)
  await appendMemoryEvent(context.memoryCwd, {
    id: randomUUID(),
    action: 'pending',
    at: now,
    reason: 'User submitted affect correction from Web control console',
    candidateId: merged.id,
    runId: parsed.runId,
    details: {
      target: parsed.target,
      sessionId: parsed.sessionId,
      source: 'web-control-console'
    }
  })
  writeControlJson(response, 202, controlOk({ candidateId: merged.id, candidate: merged }))
}

function parseCorrectionInput(body: unknown): (
  | {
      ok: true
      correction: string
      target: AffectCorrectionTarget
      sessionId?: string
      runId?: string
    }
  | { ok: false; error: string }
) {
  if (!isObject(body)) {
    return { ok: false, error: 'correction must be a string.' }
  }
  if (typeof body.correction !== 'string' || body.correction.trim().length === 0) {
    return { ok: false, error: 'correction must be a string.' }
  }
  const target = body.target === undefined ? 'strategy' : body.target
  if (target !== 'affect' && target !== 'relationship' && target !== 'strategy') {
    return { ok: false, error: 'target must be affect, relationship, or strategy.' }
  }
  if (body.sessionId !== undefined && typeof body.sessionId !== 'string') {
    return { ok: false, error: 'sessionId must be a string.' }
  }
  if (body.runId !== undefined && typeof body.runId !== 'string') {
    return { ok: false, error: 'runId must be a string.' }
  }
  return {
    ok: true,
    correction: body.correction.trim(),
    target,
    ...(body.sessionId === undefined ? {} : { sessionId: body.sessionId }),
    ...(body.runId === undefined ? {} : { runId: body.runId })
  }
}

function memoryTypeForTarget(target: AffectCorrectionTarget): MemoryType {
  return target === 'affect' ? 'affective_pattern' : 'interaction_style'
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'correction'
}

function isRequestBodyTooLargeError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Request body too large.'
}

