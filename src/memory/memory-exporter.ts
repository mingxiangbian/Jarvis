import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { ensureMemoryRoot } from './paths.js'
import { ensureWritableMemoryRootPath, readActiveMemories, readActiveMemoriesFromRoot } from './memory-store.js'
import type { CyreneMemory } from './types.js'

const GENERATED_HEADER = '<!-- Generated from .cyrene/memory/index.jsonl. Do not edit manually. -->'
const PROJECTION_FILES = ['MEMORY.md', 'PROJECT.md', 'PERSONAL.md', 'AFFECT.md'] as const
const ROOT_PROJECTION_FILE = 'MEMORY.md'

export async function renderMemoryProjections(cwd: string): Promise<void> {
  const root = await ensureMemoryRoot(cwd)
  const memories = await readActiveMemories(cwd)
  await writeMemoryProjections(root, memories)
}

export async function renderMemoryProjectionsFromRoot(memoryRoot: string): Promise<void> {
  const root = await assertMemoryProjectionTargetsSafe(memoryRoot)
  const memories = await readActiveMemoriesFromRoot(root)
  await writeMemoryProjections(root, memories)
}

export async function assertMemoryProjectionTargetsSafe(memoryRoot: string): Promise<string> {
  const root = await ensureWritableMemoryRootPath(memoryRoot)
  const projectionsDir = await ensureSafeGeneratedDirectory(root, 'projections')

  await Promise.all([
    ...PROJECTION_FILES.map((filename) => assertSafeGeneratedFileTarget(root, projectionsDir, filename)),
    assertSafeGeneratedFileTarget(root, root, ROOT_PROJECTION_FILE)
  ])

  return root
}

async function writeMemoryProjections(root: string, memories: CyreneMemory[]): Promise<void> {
  const safeRoot = await assertMemoryProjectionTargetsSafe(root)
  const projectionsDir = join(safeRoot, 'projections')

  const overall = formatMemoryProjection(memories, 'overall')
  await Promise.all([
    writeSafeGeneratedFile(safeRoot, projectionsDir, 'MEMORY.md', overall),
    writeSafeGeneratedFile(safeRoot, projectionsDir, 'PROJECT.md', formatMemoryProjection(memories, 'project')),
    writeSafeGeneratedFile(safeRoot, projectionsDir, 'PERSONAL.md', formatMemoryProjection(memories, 'personal')),
    writeSafeGeneratedFile(safeRoot, projectionsDir, 'AFFECT.md', formatMemoryProjection(memories, 'affect')),
    writeSafeGeneratedFile(safeRoot, safeRoot, ROOT_PROJECTION_FILE, overall)
  ])
}

async function ensureSafeGeneratedDirectory(root: string, dirname: string): Promise<string> {
  const dirPath = join(root, dirname)
  try {
    return await getSafeGeneratedDirectory(root, dirPath)
  } catch (error) {
    if (!isFileErrorCode(error, 'ENOENT')) {
      throw error
    }
  }

  await mkdir(dirPath).catch((error: unknown) => {
    if (!isFileErrorCode(error, 'EEXIST')) {
      throw error
    }
  })
  return getSafeGeneratedDirectory(root, dirPath)
}

async function getSafeGeneratedDirectory(root: string, dirPath: string): Promise<string> {
  const stats = await lstat(dirPath)
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to use memory projection symlink: ${dirPath}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`Refusing to use non-directory memory projection path: ${dirPath}`)
  }

  const dirRealPath = await realpath(dirPath)
  if (!isPathInside(root, dirRealPath)) {
    throw new Error(`Refusing to use memory projection path outside memory root: ${dirPath}`)
  }
  return dirRealPath
}

async function writeSafeGeneratedFile(
  root: string,
  parentDir: string,
  filename: string,
  content: string
): Promise<void> {
  await assertSafeGeneratedFileTarget(root, parentDir, filename)
  const targetPath = join(parentDir, filename)
  const tempPath = join(parentDir, `.${filename}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`)
  const file = await open(tempPath, 'wx')

  try {
    await file.writeFile(content, 'utf8')
  } catch (error) {
    await file.close()
    await rm(tempPath, { force: true })
    throw error
  }

  await file.close()

  try {
    await rename(tempPath, targetPath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

async function assertSafeGeneratedFileTarget(root: string, parentDir: string, filename: string): Promise<void> {
  const parentStats = await lstat(parentDir)
  if (parentStats.isSymbolicLink()) {
    throw new Error(`Refusing to use memory projection symlink: ${parentDir}`)
  }
  if (!parentStats.isDirectory()) {
    throw new Error(`Refusing to use non-directory memory projection path: ${parentDir}`)
  }

  const parentRealPath = await realpath(parentDir)
  if (!isPathInside(root, parentRealPath)) {
    throw new Error(`Refusing to use memory projection path outside memory root: ${parentDir}`)
  }

  const targetPath = join(parentRealPath, filename)
  let stats
  try {
    stats = await lstat(targetPath)
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return
    }
    throw error
  }

  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to use memory projection symlink: ${targetPath}`)
  }
  if (!stats.isFile()) {
    throw new Error(`Refusing to use non-file memory projection path: ${targetPath}`)
  }
}

function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
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
