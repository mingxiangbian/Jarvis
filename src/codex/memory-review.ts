import { createHash, randomUUID } from 'node:crypto'
import { codexProjectMemoryRoot } from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'
import { renderMemoryProjectionsFromRoot } from '../memory/memory-exporter.js'
import {
  appendMemoryEventFromRoot,
  appendTombstoneFromRoot,
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from '../memory/memory-store.js'
import { activateCandidate, validateMemoryCandidate } from '../memory/memory-validator.js'
import type { CyreneMemory, MemoryTombstone, PendingMemory } from '../memory/types.js'

export interface CodexPendingMemorySummary {
  id: string
  domain: PendingMemory['domain']
  type: PendingMemory['type']
  strength: PendingMemory['strength']
  scope: PendingMemory['scope']
  content: string
  normalizedKey: string
  source: PendingMemory['source']
  seenCount: number
  firstSeenAt: string
  lastSeenAt: string
  expiresAt?: string
  reviewHash: string
  evidenceSummary: string[]
  scores: PendingMemory['scores']
}

export interface CodexPendingReviewNotice {
  count: number
  hasItems: boolean
  newestCandidateId?: string
  newestPreview?: string
}

interface CodexPendingMemoryProject {
  projectId: string
  displayName: string
}

export interface CodexPendingMemoryListResult {
  project: CodexPendingMemoryProject
  pending: CodexPendingMemorySummary[]
  total: number
  memoryRoot: string
}

export interface CodexPendingMemoryGetResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | {
        action: 'get'
        candidate: PendingMemory
        reviewHash: string
      }
    | {
        action: 'not_found'
        candidateId: string
        reason: string
      }
}

export interface CodexPendingMemoryPromoteResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | {
        action: 'promote'
        candidateId: string
        memory: CyreneMemory
        reviewHash: string
      }
    | {
        action: 'not_found'
        candidateId: string
        reason: string
      }
    | {
        action: 'conflict'
        candidateId: string
        reason: string
        latest: CodexPendingMemorySummary
      }
    | {
        action: 'rejected_by_validator'
        candidateId: string
        reason: string
        tombstone: MemoryTombstone
      }
}

export interface CodexPendingMemoryRejectResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | {
        action: 'reject'
        candidateId: string
        tombstone: MemoryTombstone
        reviewHash: string
      }
    | {
        action: 'not_found'
        candidateId: string
        reason: string
      }
    | {
        action: 'conflict'
        candidateId: string
        reason: string
        latest: CodexPendingMemorySummary
      }
}

export function reviewHashForPendingMemory(candidate: PendingMemory): string {
  const payload = {
    id: candidate.id,
    content: candidate.content,
    normalizedKey: candidate.normalizedKey,
    evidence: candidate.evidence,
    scores: candidate.scores,
    lastSeenAt: candidate.lastSeenAt
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function summarizePendingMemory(candidate: PendingMemory): CodexPendingMemorySummary {
  return {
    id: candidate.id,
    domain: candidate.domain,
    type: candidate.type,
    strength: candidate.strength,
    scope: candidate.scope,
    content: candidate.content,
    normalizedKey: candidate.normalizedKey,
    source: candidate.source,
    seenCount: candidate.seenCount,
    firstSeenAt: candidate.firstSeenAt,
    lastSeenAt: candidate.lastSeenAt,
    expiresAt: candidate.expiresAt,
    reviewHash: reviewHashForPendingMemory(candidate),
    evidenceSummary: candidate.evidence
      .map((entry) => entry.summary ?? entry.quote ?? entry.runId ?? '')
      .filter((text) => text.trim() !== ''),
    scores: candidate.scores
  }
}

export async function listCodexPendingMemories(input: {
  cwd: string
  limit?: number
}): Promise<CodexPendingMemoryListResult> {
  const { project, memoryRoot } = await getProjectAndMemoryRoot(input.cwd)
  const pending = sortPendingNewestFirst(await readPendingMemoriesFromRoot(memoryRoot))
  const summaries = pending.map((candidate) => summarizePendingMemory(candidate))
  return {
    project,
    pending: input.limit === undefined ? summaries : summaries.slice(0, input.limit),
    total: pending.length,
    memoryRoot
  }
}

export async function getCodexPendingMemory(input: {
  cwd: string
  id: string
}): Promise<CodexPendingMemoryGetResult> {
  const { project, memoryRoot } = await getProjectAndMemoryRoot(input.cwd)
  const candidate = await findPendingCandidate(memoryRoot, input.id)
  if (candidate === undefined) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'not_found',
        candidateId: input.id,
        reason: 'Pending memory candidate not found'
      }
    }
  }

  return {
    project,
    memoryRoot,
    result: {
      action: 'get',
      candidate,
      reviewHash: reviewHashForPendingMemory(candidate)
    }
  }
}

export async function promoteCodexPendingMemory(input: {
  cwd: string
  id: string
  reviewHash: string
  reason?: string
  now?: string
}): Promise<CodexPendingMemoryPromoteResult> {
  const now = input.now ?? new Date().toISOString()
  const { project, memoryRoot } = await getProjectAndMemoryRoot(input.cwd)
  const pending = await readPendingMemoriesFromRoot(memoryRoot)
  const candidate = pending.find((memory) => memory.id === input.id)
  if (candidate === undefined) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'not_found',
        candidateId: input.id,
        reason: 'Pending memory candidate not found'
      }
    }
  }

  const latestReviewHash = reviewHashForPendingMemory(candidate)
  if (latestReviewHash !== input.reviewHash) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'conflict',
        candidateId: input.id,
        reason: 'Pending memory candidate changed since review',
        latest: summarizePendingMemory(candidate)
      }
    }
  }

  const [active, tombstones] = await Promise.all([
    readActiveMemoriesFromRoot(memoryRoot),
    readTombstonesFromRoot(memoryRoot)
  ])
  const decision = validateMemoryCandidate({ candidate, existingMemories: active, tombstones, now })
  if (decision.action === 'reject') {
    return {
      project,
      memoryRoot,
      result: {
        action: 'rejected_by_validator',
        candidateId: candidate.id,
        reason: decision.reason,
        tombstone: decision.tombstone
      }
    }
  }

  const confirmedCandidate: PendingMemory = { ...candidate, userConfirmed: true }
  const memory = activateCandidate(confirmedCandidate, now)
  const nextActive = upsertActiveMemory(active, memory)
  const nextPending = pending.filter((memoryCandidate) => memoryCandidate.id !== candidate.id)

  await writeActiveMemoriesFromRoot(memoryRoot, nextActive)
  await writePendingMemoriesFromRoot(memoryRoot, nextPending)
  await appendMemoryEventFromRoot(memoryRoot, {
    id: randomUUID(),
    action: 'promote',
    at: now,
    reason: input.reason ?? 'Approved by Codex pending memory review',
    memoryId: memory.id,
    candidateId: candidate.id
  })
  await renderMemoryProjectionsFromRoot(memoryRoot)

  return {
    project,
    memoryRoot,
    result: {
      action: 'promote',
      candidateId: candidate.id,
      memory,
      reviewHash: latestReviewHash
    }
  }
}

export async function rejectCodexPendingMemory(input: {
  cwd: string
  id: string
  reviewHash: string
  reason?: string
  now?: string
}): Promise<CodexPendingMemoryRejectResult> {
  const now = input.now ?? new Date().toISOString()
  const { project, memoryRoot } = await getProjectAndMemoryRoot(input.cwd)
  const pending = await readPendingMemoriesFromRoot(memoryRoot)
  const candidate = pending.find((memory) => memory.id === input.id)
  if (candidate === undefined) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'not_found',
        candidateId: input.id,
        reason: 'Pending memory candidate not found'
      }
    }
  }

  const latestReviewHash = reviewHashForPendingMemory(candidate)
  if (latestReviewHash !== input.reviewHash) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'conflict',
        candidateId: input.id,
        reason: 'Pending memory candidate changed since review',
        latest: summarizePendingMemory(candidate)
      }
    }
  }

  const tombstone = tombstoneForRejectedCandidate(candidate, now)
  const nextPending = pending.filter((memoryCandidate) => memoryCandidate.id !== candidate.id)
  await writePendingMemoriesFromRoot(memoryRoot, nextPending)
  await appendTombstoneFromRoot(memoryRoot, tombstone)
  await appendMemoryEventFromRoot(memoryRoot, {
    id: randomUUID(),
    action: 'reject',
    at: now,
    reason: input.reason ?? 'Rejected by Codex pending memory review',
    candidateId: candidate.id
  })

  return {
    project,
    memoryRoot,
    result: {
      action: 'reject',
      candidateId: candidate.id,
      tombstone,
      reviewHash: latestReviewHash
    }
  }
}

export async function getCodexPendingReviewNotice(input: { cwd: string }): Promise<CodexPendingReviewNotice> {
  const { memoryRoot } = await getProjectAndMemoryRoot(input.cwd)
  const pending = sortPendingNewestFirst(await readPendingMemoriesFromRoot(memoryRoot))
  const newest = pending[0]
  return {
    count: pending.length,
    hasItems: pending.length > 0,
    ...(newest === undefined
      ? {}
      : {
          newestCandidateId: newest.id,
          newestPreview: previewContent(newest.content)
        })
  }
}

function upsertActiveMemory(active: CyreneMemory[], memory: CyreneMemory): CyreneMemory[] {
  const index = active.findIndex((candidate) => candidate.id === memory.id || candidate.normalizedKey === memory.normalizedKey)
  if (index < 0) {
    return [...active, memory]
  }

  const next = [...active]
  next[index] = memory
  return next
}

function tombstoneForRejectedCandidate(candidate: PendingMemory, now: string): MemoryTombstone {
  return {
    id: `tombstone-${candidate.id}`,
    memoryId: candidate.id,
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

async function getProjectAndMemoryRoot(cwd: string): Promise<{
  project: CodexPendingMemoryProject
  memoryRoot: string
}> {
  const identity = await identifyCodexProject(cwd)
  return {
    project: { projectId: identity.projectId, displayName: identity.displayName },
    memoryRoot: codexProjectMemoryRoot(identity.projectId)
  }
}

async function findPendingCandidate(memoryRoot: string, id: string): Promise<PendingMemory | undefined> {
  return (await readPendingMemoriesFromRoot(memoryRoot)).find((candidate) => candidate.id === id)
}

function sortPendingNewestFirst(pending: PendingMemory[]): PendingMemory[] {
  return [...pending].sort((left, right) => {
    const lastSeen = right.lastSeenAt.localeCompare(left.lastSeenAt)
    return lastSeen === 0 ? left.id.localeCompare(right.id) : lastSeen
  })
}

function previewContent(content: string): string {
  return content.length <= 160 ? content : `${content.slice(0, 157)}...`
}
