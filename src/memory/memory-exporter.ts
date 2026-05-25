import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureMemoryRoot } from './paths.js'
import { ensureWritableMemoryRootPath, readActiveMemories, readActiveMemoriesFromRoot } from './memory-store.js'
import type { CyreneMemory } from './types.js'

const GENERATED_HEADER = '<!-- Generated from .cyrene/memory/index.jsonl. Do not edit manually. -->'

export async function renderMemoryProjections(cwd: string): Promise<void> {
  const root = await ensureMemoryRoot(cwd)
  const memories = await readActiveMemories(cwd)
  await writeMemoryProjections(root, memories)
}

export async function renderMemoryProjectionsFromRoot(memoryRoot: string): Promise<void> {
  const root = await ensureWritableMemoryRootPath(memoryRoot)
  const memories = await readActiveMemoriesFromRoot(root)
  await writeMemoryProjections(root, memories)
}

async function writeMemoryProjections(root: string, memories: CyreneMemory[]): Promise<void> {
  const projectionsDir = join(root, 'projections')
  await mkdir(projectionsDir, { recursive: true })

  const overall = formatMemoryProjection(memories, 'overall')
  await Promise.all([
    writeFile(join(projectionsDir, 'MEMORY.md'), overall, 'utf8'),
    writeFile(join(projectionsDir, 'PROJECT.md'), formatMemoryProjection(memories, 'project'), 'utf8'),
    writeFile(join(projectionsDir, 'PERSONAL.md'), formatMemoryProjection(memories, 'personal'), 'utf8'),
    writeFile(join(projectionsDir, 'AFFECT.md'), formatMemoryProjection(memories, 'affect'), 'utf8'),
    writeFile(join(root, 'MEMORY.md'), overall, 'utf8')
  ])
}

export function formatMemoryProjection(
  memories: CyreneMemory[],
  kind: 'overall' | 'project' | 'personal' | 'affect'
): string {
  const visible = memories.filter((memory) => isVisibleInProjection(memory, kind))
  const grouped = groupMemories(visible)
  const lines = [GENERATED_HEADER, '', projectionTitle(kind), '']

  for (const [heading, entries] of grouped) {
    lines.push(`## ${heading}`, '')
    for (const memory of entries) {
      lines.push(
        `- ${memory.content} domain=${memory.domain} type=${memory.type} strength=${memory.strength}`
      )
    }
    lines.push('')
  }

  if (grouped.length === 0) {
    lines.push('_No active memories._', '')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function isVisibleInProjection(memory: CyreneMemory, kind: 'overall' | 'project' | 'personal' | 'affect'): boolean {
  if (memory.status !== 'active') {
    return false
  }

  if (kind === 'project') {
    return memory.domain === 'project' || memory.domain === 'procedural' || memory.domain === 'system'
  }

  if (kind === 'personal') {
    return (
      (memory.domain === 'personal' || memory.domain === 'relationship') &&
      memory.scores.safety >= 0.8 &&
      memory.scores.sensitivity <= 0.6
    )
  }

  if (kind === 'affect') {
    return memory.domain === 'affective' && memory.scores.safety >= 0.9 && memory.scores.sensitivity <= 0.3
  }

  return memory.scores.safety >= 0.8 && memory.scores.sensitivity <= 0.6
}

function projectionTitle(kind: 'overall' | 'project' | 'personal' | 'affect'): string {
  if (kind === 'project') return '# Cyrene Project Memory Projection'
  if (kind === 'personal') return '# Cyrene Personal Memory Projection'
  if (kind === 'affect') return '# Cyrene Affective Memory Projection'
  return '# Cyrene Memory Projection'
}

function groupMemories(memories: CyreneMemory[]): Array<[string, CyreneMemory[]]> {
  const groups = new Map<string, CyreneMemory[]>()
  for (const memory of memories) {
    const heading = formatHeading(memory)
    groups.set(heading, [...(groups.get(heading) ?? []), memory])
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
}

function formatHeading(memory: CyreneMemory): string {
  if (memory.domain === 'project') return 'Project Facts'
  if (memory.domain === 'procedural') return 'Procedural Rules'
  if (memory.domain === 'system') return 'System Policies'
  if (memory.domain === 'personal') return 'Personal Preferences'
  if (memory.domain === 'relationship') return 'Relationship Boundaries'
  return 'Affective Patterns'
}
