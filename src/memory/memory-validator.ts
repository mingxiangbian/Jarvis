import type { CyreneMemory, MemoryDecision, MemoryTombstone, PendingMemory } from './types.js'

export interface ValidateMemoryCandidateInput {
  candidate: PendingMemory
  existingMemories: CyreneMemory[]
  tombstones: MemoryTombstone[]
  now?: string
}

export function validateMemoryCandidate(input: ValidateMemoryCandidateInput): MemoryDecision {
  const now = input.now ?? new Date().toISOString()
  const candidate = normalizeCandidate(input.candidate)
  const tombstone = input.tombstones.find((entry) => isActiveTombstoneMatch(entry, candidate, now))
  if (tombstone !== undefined) {
    return reject(candidate, now, `Memory was previously ${tombstone.reason}`)
  }

  if (!hasValidEvidence(candidate)) {
    return reject(candidate, now, 'Memory candidate is missing auditable evidence')
  }

  if (candidate.type === 'episode' || candidate.strength === 'session' || candidate.scope === 'session') {
    if (candidate.expiresAt === undefined) {
      return reject(candidate, now, 'Session or episodic memory requires expiresAt')
    }
  }

  if (isDiagnosticAffectiveClaim(candidate.content)) {
    return reject(candidate, now, 'Affective memory cannot contain diagnostic claims')
  }

  if (candidate.domain === 'affective' && (candidate.strength === 'hard' || candidate.scope === 'global')) {
    return reject(candidate, now, 'Affective memory cannot auto-write as hard/global in Phase 3')
  }

  if (candidate.scores.evidenceStrength < 0.55 || candidate.scores.safety < 0.65) {
    return reject(candidate, now, 'Memory candidate is below minimum evidence or safety threshold')
  }

  if (hasAssistantDerivedEvidence(candidate)) {
    return {
      action: 'pending',
      reason: 'Memory candidate is based on assistant output and requires user confirmation',
      candidate
    }
  }

  if (isTentativeOrRecentPersonalMemory(candidate)) {
    return {
      action: 'pending',
      reason: 'Tentative or recent personal memory requires repeated evidence',
      candidate: { ...candidate, strength: 'soft' }
    }
  }

  if (isMemoryRecallQuestion(candidate)) {
    return {
      action: 'pending',
      reason: 'Memory recall questions require confirmation before creating new rules',
      candidate
    }
  }

  if (!isAutoWritable(candidate)) {
    return {
      action: 'pending',
      reason: 'Memory candidate requires more evidence or confirmation',
      candidate
    }
  }

  return {
    action: 'auto_write',
    reason: 'Memory candidate passed domain policy',
    memory: activateCandidate(candidate, now)
  }
}

export function activateCandidate(candidate: PendingMemory, now: string): CyreneMemory {
  return {
    id: candidate.id,
    domain: candidate.domain,
    type: candidate.type,
    strength: candidate.strength,
    scope: candidate.scope === 'session' ? 'project' : candidate.scope,
    status: 'active',
    content: candidate.content,
    normalizedKey: candidate.normalizedKey,
    evidence: candidate.evidence,
    source: candidate.source,
    scores: candidate.scores,
    createdAt: candidate.firstSeenAt || now,
    updatedAt: now,
    expiresAt: candidate.expiresAt,
    userConfirmed: candidate.userConfirmed,
    tags: candidate.tags,
    ...(candidate.conflictsWith === undefined ? {} : { supersedes: candidate.conflictsWith })
  }
}

export function isPromotablePending(candidate: PendingMemory): boolean {
  return (
    candidate.seenCount >= 2 &&
    hasValidEvidence(candidate) &&
    !isDiagnosticAffectiveClaim(candidate.content) &&
    candidate.scores.evidenceStrength >= 0.75 &&
    candidate.scores.stability >= 0.7 &&
    candidate.scores.usefulness >= 0.6 &&
    candidate.scores.safety >= 0.8 &&
    candidate.scores.sensitivity <= 0.6 &&
    candidate.domain !== 'affective'
  )
}

function normalizeCandidate(candidate: PendingMemory): PendingMemory {
  if (candidate.type === 'episode') {
    return { ...candidate, domain: 'personal', strength: 'session', scope: 'session' }
  }
  if (candidate.domain === 'personal' && candidate.source !== 'user_explicit' && candidate.userConfirmed !== true) {
    return { ...candidate, strength: 'soft' }
  }
  if (candidate.domain === 'relationship' && candidate.source !== 'user_explicit' && candidate.userConfirmed !== true) {
    return { ...candidate, strength: 'soft' }
  }
  if (candidate.domain === 'affective') {
    return {
      ...candidate,
      strength: candidate.strength === 'hard' ? 'soft' : candidate.strength,
      scope: 'session'
    }
  }
  return candidate
}

function isAutoWritable(candidate: PendingMemory): boolean {
  if (
    candidate.scores.evidenceStrength < 0.8 ||
    candidate.scores.stability < 0.7 ||
    candidate.scores.usefulness < 0.6 ||
    candidate.scores.safety < 0.8 ||
    candidate.scores.sensitivity > 0.6
  ) {
    return false
  }

  if (candidate.domain === 'project') {
    return candidate.strength === 'hard'
  }
  if (candidate.domain === 'procedural') {
    return candidate.strength === 'hard' && candidate.scores.usefulness >= 0.75 && isTrustedAutoWriteSource(candidate)
  }
  if (candidate.domain === 'system') {
    return candidate.source === 'user_explicit' || candidate.source === 'tool_trace' || candidate.source === 'file'
  }
  if (candidate.domain === 'personal') {
    return candidate.strength === 'hard' && (candidate.source === 'user_explicit' || candidate.userConfirmed === true)
  }
  if (candidate.domain === 'relationship') {
    return candidate.strength === 'hard' && (candidate.source === 'user_explicit' || candidate.userConfirmed === true)
  }
  return false
}

function isTrustedAutoWriteSource(candidate: PendingMemory): boolean {
  return (
    candidate.userConfirmed === true ||
    candidate.source === 'user_explicit' ||
    candidate.source === 'tool_trace' ||
    candidate.source === 'file' ||
    candidate.source === 'legacy_markdown'
  )
}

function hasAssistantDerivedEvidence(candidate: PendingMemory): boolean {
  if (candidate.userConfirmed === true) {
    return false
  }

  return candidate.evidence.some((entry) => {
    const text = `${entry.summary ?? ''} ${entry.quote ?? ''}`.toLowerCase()
    return (
      text.includes('assistant provided') ||
      text.includes('assistant proposed') ||
      text.includes('assistant offered') ||
      text.includes('assistant suggested') ||
      text.includes('accepted without correction') ||
      text.includes('did not reject') ||
      text.includes('without correction')
    )
  })
}

function isTentativeOrRecentPersonalMemory(candidate: PendingMemory): boolean {
  if (candidate.userConfirmed === true) {
    return false
  }
  if (candidate.domain !== 'personal' && candidate.domain !== 'relationship') {
    return false
  }
  if (candidate.type !== 'user_preference' && candidate.type !== 'interaction_style' && candidate.type !== 'relationship_boundary') {
    return false
  }

  return /最近|好像|可能|暂时|似乎|感觉|不确定|\blately\b|\brecently\b|\bmaybe\b|\bmight\b|\bseems?\b|\bfor now\b|\btentative\b|\btemporar(?:y|ily)\b/i.test(
    evidenceText(candidate)
  )
}

function isMemoryRecallQuestion(candidate: PendingMemory): boolean {
  if (candidate.userConfirmed === true || hasDirectMemoryInstruction(candidate)) {
    return false
  }

  return /你应该怎么|你会怎么|应该如何|会如何|还记得|记得.*吗|how should you|how would you|what should you|do you remember/i.test(
    evidenceText(candidate)
  )
}

function hasDirectMemoryInstruction(candidate: PendingMemory): boolean {
  return /记住|请记住|以后默认|之后默认|以后你要|以后请|remember that|please remember|from now on|default to/i.test(
    evidenceText(candidate)
  )
}

function evidenceText(candidate: PendingMemory): string {
  return candidate.evidence.map((entry) => `${entry.summary ?? ''} ${entry.quote ?? ''}`).join(' ')
}

function reject(candidate: PendingMemory, now: string, reason: string): MemoryDecision {
  return {
    action: 'reject',
    reason,
    tombstone: {
      id: `tombstone-${candidate.id}`,
      normalizedKey: candidate.normalizedKey,
      domain: candidate.domain,
      type: candidate.type,
      strength: candidate.strength,
      scope: candidate.scope,
      reason: 'rejected',
      createdAt: now,
      evidence: candidate.evidence
    }
  }
}

function hasValidEvidence(candidate: PendingMemory): boolean {
  return candidate.evidence.some((entry) =>
    (entry.runId !== undefined && entry.runId.trim() !== '') ||
    (entry.summary !== undefined && entry.summary.trim() !== '') ||
    (entry.quote !== undefined && entry.quote.trim() !== '')
  )
}

function isActiveTombstoneMatch(tombstone: MemoryTombstone, candidate: PendingMemory, now: string): boolean {
  return (
    tombstone.normalizedKey === candidate.normalizedKey &&
    (tombstone.expiresAt === undefined || tombstone.expiresAt > now)
  )
}

function isDiagnosticAffectiveClaim(content: string): boolean {
  return /\b(anxious|unstable|insecurity|insecure|dependent|dependency|fragile|needy)\b|焦虑|不稳定|缺乏安全感|情感依赖/.test(
    content.toLowerCase()
  )
}
