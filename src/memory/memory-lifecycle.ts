import { randomUUID } from 'node:crypto'
import { renderMemoryProjections } from './memory-exporter.js'
import {
  appendMemoryEvent,
  appendTombstone,
  readActiveMemories,
  readPendingMemories,
  readTombstones,
  upsertPendingMemory,
  writeActiveMemories,
  writePendingMemories
} from './memory-store.js'
import type { CyreneMemory, MemoryDecision, PendingMemory } from './types.js'
import { activateCandidate, isPromotablePending, validateMemoryCandidate } from './memory-validator.js'

export type ApplyMemoryDecisionResult =
  | { action: 'create'; memoryId: string }
  | { action: 'pending'; candidateId: string }
  | { action: 'reject'; tombstoneId: string }
  | { action: 'update'; memoryId: string }
  | { action: 'archive'; memoryId: string }
  | { action: 'promote'; memoryId: string }

export interface ProcessMemoryCandidateInput {
  cwd: string
  candidate: PendingMemory
  now?: string
}

export async function processMemoryCandidate(input: ProcessMemoryCandidateInput): Promise<ApplyMemoryDecisionResult> {
  const now = input.now ?? new Date().toISOString()
  const [existingMemories, tombstones] = await Promise.all([
    readActiveMemories(input.cwd),
    readTombstones(input.cwd)
  ])
  const decision = validateMemoryCandidate({
    candidate: input.candidate,
    existingMemories,
    tombstones,
    now
  })

  if (decision.action !== 'pending') {
    return applyMemoryDecision(input.cwd, decision, now)
  }

  const merged = await upsertPendingMemory(input.cwd, decision.candidate)
  if (isPromotablePending(merged)) {
    const active = activateCandidate(merged, now)
    await writeActiveMemories(input.cwd, upsertActiveMemory(existingMemories, active))
    await removePending(input.cwd, merged.id)
    await appendMemoryEvent(input.cwd, {
      id: randomUUID(),
      action: 'promote',
      at: now,
      reason: 'Pending memory gathered repeated evidence',
      memoryId: active.id,
      candidateId: merged.id
    })
    await renderMemoryProjections(input.cwd)
    return { action: 'promote', memoryId: active.id }
  }

  await appendMemoryEvent(input.cwd, {
    id: randomUUID(),
    action: 'pending',
    at: now,
    reason: decision.reason,
    candidateId: merged.id
  })
  return { action: 'pending', candidateId: merged.id }
}

export async function applyMemoryDecision(
  cwd: string,
  decision: MemoryDecision,
  now = new Date().toISOString()
): Promise<ApplyMemoryDecisionResult> {
  if (decision.action === 'auto_write') {
    const active = await readActiveMemories(cwd)
    await writeActiveMemories(cwd, upsertActiveMemory(active, decision.memory))
    await appendMemoryEvent(cwd, {
      id: randomUUID(),
      action: 'create',
      at: now,
      reason: decision.reason,
      memoryId: decision.memory.id
    })
    await renderMemoryProjections(cwd)
    return { action: 'create', memoryId: decision.memory.id }
  }

  if (decision.action === 'pending') {
    const merged = await upsertPendingMemory(cwd, decision.candidate)
    await appendMemoryEvent(cwd, {
      id: randomUUID(),
      action: 'pending',
      at: now,
      reason: decision.reason,
      candidateId: merged.id
    })
    return { action: 'pending', candidateId: merged.id }
  }

  if (decision.action === 'reject') {
    await appendTombstone(cwd, decision.tombstone)
    await appendMemoryEvent(cwd, {
      id: randomUUID(),
      action: 'reject',
      at: now,
      reason: decision.reason,
      candidateId: decision.tombstone.id
    })
    return { action: 'reject', tombstoneId: decision.tombstone.id }
  }

  if (decision.action === 'update_existing') {
    const active = await readActiveMemories(cwd)
    const updated = active.map((memory) =>
      memory.id === decision.targetMemoryId
        ? ({ ...memory, ...decision.patch, updatedAt: now, status: 'active' } as CyreneMemory)
        : memory
    )
    await writeActiveMemories(cwd, updated)
    await appendMemoryEvent(cwd, {
      id: randomUUID(),
      action: 'update',
      at: now,
      reason: decision.reason,
      memoryId: decision.targetMemoryId
    })
    await renderMemoryProjections(cwd)
    return { action: 'update', memoryId: decision.targetMemoryId }
  }

  const active = await readActiveMemories(cwd)
  await writeActiveMemories(cwd, active.filter((memory) => memory.id !== decision.targetMemoryId))
  await appendTombstone(cwd, decision.tombstone)
  await appendMemoryEvent(cwd, {
    id: randomUUID(),
    action: 'archive',
    at: now,
    reason: decision.reason,
    memoryId: decision.targetMemoryId
  })
  await renderMemoryProjections(cwd)
  return { action: 'archive', memoryId: decision.targetMemoryId }
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

async function removePending(cwd: string, pendingId: string): Promise<void> {
  const pending = await readPendingMemories(cwd)
  await writePendingMemories(cwd, pending.filter((candidate) => candidate.id !== pendingId))
}
