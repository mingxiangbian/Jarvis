import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { renderMemoryProjections } from '../../memory/memory-exporter.js'
import {
  appendMemoryEvent,
  appendTombstone,
  readActiveMemories,
  readPendingMemories,
  writeActiveMemories,
  writePendingMemories
} from '../../memory/memory-store.js'
import type { CyreneMemory, MemoryEvent, MemoryTombstone, PendingMemory } from '../../memory/types.js'
import { controlError, controlOk, writeControlJson } from './types.js'

export interface MemoryApiContext {
  memoryCwd: string
}

export async function getMemoryList(response: ServerResponse, context: MemoryApiContext): Promise<void> {
  const [active, pending] = await Promise.all([
    readActiveMemories(context.memoryCwd),
    readPendingMemories(context.memoryCwd)
  ])
  writeControlJson(response, 200, controlOk({
    active: active.map(summarizeMemory),
    pending: pending.map(summarizeMemory)
  }))
}

export async function getMemoryDetail(
  response: ServerResponse,
  context: MemoryApiContext,
  memoryId: string
): Promise<void> {
  if (!isSafeMemoryId(memoryId)) {
    writeControlJson(response, 400, controlError('Invalid memory id.'))
    return
  }

  const memory = await findMemory(context.memoryCwd, memoryId)
  if (memory === undefined) {
    writeControlJson(response, 404, controlError('Memory not found.'))
    return
  }
  writeControlJson(response, 200, controlOk({ memory }))
}

export async function archiveMemory(
  response: ServerResponse,
  context: MemoryApiContext,
  memoryId: string
): Promise<void> {
  if (!isSafeMemoryId(memoryId)) {
    writeControlJson(response, 400, controlError('Invalid memory id.'))
    return
  }

  const [active, pending] = await Promise.all([
    readActiveMemories(context.memoryCwd),
    readPendingMemories(context.memoryCwd)
  ])
  const activeMemory = active.find((memory) => memory.id === memoryId)
  const pendingMemory = pending.find((memory) => memory.id === memoryId)
  const memory = activeMemory ?? pendingMemory
  if (memory === undefined) {
    writeControlJson(response, 404, controlError('Memory not found.'))
    return
  }

  const now = new Date().toISOString()
  if (activeMemory !== undefined) {
    await writeActiveMemories(context.memoryCwd, active.filter((candidate) => candidate.id !== memoryId))
  } else {
    await writePendingMemories(context.memoryCwd, pending.filter((candidate) => candidate.id !== memoryId))
  }
  await appendTombstone(context.memoryCwd, tombstoneForMemory(memory, now))
  await appendMemoryEvent(context.memoryCwd, archiveEvent(memory, now))
  if (activeMemory !== undefined) {
    await renderMemoryProjections(context.memoryCwd)
  }

  const [nextActive, nextPending] = await Promise.all([
    readActiveMemories(context.memoryCwd),
    readPendingMemories(context.memoryCwd)
  ])
  writeControlJson(response, 200, controlOk({
    action: 'archive',
    active: nextActive.map(summarizeMemory),
    pending: nextPending.map(summarizeMemory)
  }))
}

export async function downrankMemory(
  response: ServerResponse,
  context: MemoryApiContext,
  memoryId: string
): Promise<void> {
  if (!isSafeMemoryId(memoryId)) {
    writeControlJson(response, 400, controlError('Invalid memory id.'))
    return
  }

  const [active, pending] = await Promise.all([
    readActiveMemories(context.memoryCwd),
    readPendingMemories(context.memoryCwd)
  ])
  const activeIndex = active.findIndex((memory) => memory.id === memoryId)
  const pendingIndex = pending.findIndex((memory) => memory.id === memoryId)
  if (activeIndex < 0 && pendingIndex < 0) {
    writeControlJson(response, 404, controlError('Memory not found.'))
    return
  }

  const now = new Date().toISOString()
  const memory =
    activeIndex >= 0
      ? downrankActiveMemory(active[activeIndex], now)
      : downrankPendingMemory(pending[pendingIndex], now)

  if (activeIndex >= 0) {
    active[activeIndex] = memory as CyreneMemory
    await writeActiveMemories(context.memoryCwd, active)
    await renderMemoryProjections(context.memoryCwd)
  } else {
    pending[pendingIndex] = memory as PendingMemory
    await writePendingMemories(context.memoryCwd, pending)
  }

  await appendMemoryEvent(context.memoryCwd, {
    id: randomUUID(),
    action: 'update',
    at: now,
    reason: 'User downranked memory from Web control console',
    ...(activeIndex >= 0 ? { memoryId } : { candidateId: memoryId }),
    details: { source: 'web-control-console', feedback: 'downrank' }
  })
  writeControlJson(response, 200, controlOk({ action: 'downrank', memory: summarizeMemory(memory) }))
}

export async function strengthenMemory(
  response: ServerResponse,
  context: MemoryApiContext,
  memoryId: string
): Promise<void> {
  if (!isSafeMemoryId(memoryId)) {
    writeControlJson(response, 400, controlError('Invalid memory id.'))
    return
  }

  const [active, pending] = await Promise.all([
    readActiveMemories(context.memoryCwd),
    readPendingMemories(context.memoryCwd)
  ])
  const activeIndex = active.findIndex((memory) => memory.id === memoryId)
  const pendingIndex = pending.findIndex((memory) => memory.id === memoryId)
  if (activeIndex < 0 && pendingIndex < 0) {
    writeControlJson(response, 404, controlError('Memory not found.'))
    return
  }

  const now = new Date().toISOString()
  const memory =
    activeIndex >= 0
      ? strengthenActiveMemory(active[activeIndex], now)
      : strengthenPendingMemory(pending[pendingIndex], now)

  if (activeIndex >= 0) {
    active[activeIndex] = memory as CyreneMemory
    await writeActiveMemories(context.memoryCwd, active)
    await renderMemoryProjections(context.memoryCwd)
  } else {
    pending[pendingIndex] = memory as PendingMemory
    await writePendingMemories(context.memoryCwd, pending)
  }

  await appendMemoryEvent(context.memoryCwd, {
    id: randomUUID(),
    action: 'update',
    at: now,
    reason: 'User strengthened memory from Web control console',
    ...(activeIndex >= 0 ? { memoryId } : { candidateId: memoryId }),
    details: { source: 'web-control-console', feedback: 'strengthen' }
  })
  writeControlJson(response, 200, controlOk({ action: 'strengthen', memory: summarizeMemory(memory) }))
}

function summarizeMemory(memory: CyreneMemory | PendingMemory): CyreneMemory | PendingMemory {
  return memory
}

async function findMemory(cwd: string, memoryId: string): Promise<CyreneMemory | PendingMemory | undefined> {
  const [active, pending] = await Promise.all([
    readActiveMemories(cwd),
    readPendingMemories(cwd)
  ])
  return active.find((memory) => memory.id === memoryId) ?? pending.find((memory) => memory.id === memoryId)
}

function downrankActiveMemory(memory: CyreneMemory, now: string): CyreneMemory {
  return {
    ...memory,
    scores: downrankScores(memory.scores),
    updatedAt: now
  }
}

function downrankPendingMemory(memory: PendingMemory, now: string): PendingMemory {
  return {
    ...memory,
    scores: downrankScores(memory.scores),
    lastSeenAt: now
  }
}

function strengthenActiveMemory(memory: CyreneMemory, now: string): CyreneMemory {
  return {
    ...memory,
    scores: strengthenScores(memory.scores),
    updatedAt: now
  }
}

function strengthenPendingMemory(memory: PendingMemory, now: string): PendingMemory {
  return {
    ...memory,
    scores: strengthenScores(memory.scores),
    lastSeenAt: now
  }
}

function downrankScores<T extends { evidenceStrength: number; stability: number; usefulness: number }>(scores: T): T {
  return {
    ...scores,
    evidenceStrength: scores.evidenceStrength * 0.6,
    stability: scores.stability * 0.6,
    usefulness: scores.usefulness * 0.6
  }
}

function strengthenScores<T extends { evidenceStrength: number; stability: number; usefulness: number }>(scores: T): T {
  return {
    ...scores,
    evidenceStrength: strengthenScore(scores.evidenceStrength),
    stability: strengthenScore(scores.stability),
    usefulness: strengthenScore(scores.usefulness)
  }
}

function strengthenScore(score: number): number {
  return Math.min(1, score + (1 - score) * 0.35)
}

function tombstoneForMemory(memory: CyreneMemory | PendingMemory, now: string): MemoryTombstone {
  return {
    id: randomUUID(),
    memoryId: memory.id,
    normalizedKey: memory.normalizedKey,
    domain: memory.domain,
    type: memory.type,
    strength: memory.strength,
    scope: memory.scope,
    reason: 'archived',
    createdAt: now,
    evidence: memory.evidence
  }
}

function archiveEvent(memory: CyreneMemory | PendingMemory, now: string): MemoryEvent {
  return {
    id: randomUUID(),
    action: 'archive',
    at: now,
    reason: 'User archived memory from Web control console',
    ...(memory.status === 'active' ? { memoryId: memory.id } : { candidateId: memory.id }),
    details: { source: 'web-control-console' }
  }
}

function isSafeMemoryId(memoryId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(memoryId) && !memoryId.includes('..')
}
