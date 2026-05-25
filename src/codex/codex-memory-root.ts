import { mkdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function codexGlobalRoot(): string {
  return join(homedir(), '.cyrene', 'codex')
}

export function codexProjectRoot(projectId: string): string {
  return join(codexGlobalRoot(), 'projects', projectId)
}

export function codexProjectMemoryRoot(projectId: string): string {
  return join(codexProjectRoot(projectId), 'memory')
}

export async function ensureCodexProjectMemoryRoot(projectId: string): Promise<string> {
  const root = codexProjectMemoryRoot(projectId)
  await mkdir(root, { recursive: true })
  return realpath(root)
}
