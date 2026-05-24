import { appendFile, mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

export type RunReflectionSignal = 'none' | 'candidate'

export interface RunReflection {
  runId: string
  mode: 'light'
  summary: string
  signal: RunReflectionSignal
  proposalIds: string[]
  approvalRequired: boolean
  evalRunIds: string[]
  createdAt: string
}

export async function persistRunReflection(cwd: string, reflection: RunReflection): Promise<void> {
  assertSafeRunId(reflection.runId)
  const dir = await ensureReflectionDir(cwd)
  await writeFile(join(dir, `${reflection.runId}.json`), `${JSON.stringify(reflection, null, 2)}\n`, 'utf8')
  await appendFile(join(dir, 'index.jsonl'), `${JSON.stringify(reflection)}\n`, 'utf8')
}

export function reflectionsDir(cwd: string): string {
  return resolve(cwd, '.cyrene', 'reflections')
}

function assertSafeRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(runId) || runId.includes('..')) {
    throw new Error(`Invalid run id: ${runId}`)
  }
}

async function ensureReflectionDir(cwd: string): Promise<string> {
  const dir = reflectionsDir(cwd)
  await mkdir(dir, { recursive: true })
  const [cwdRealPath, dirRealPath] = await Promise.all([
    realpath(cwd),
    realpath(dir)
  ])
  if (dirRealPath !== cwdRealPath && !dirRealPath.startsWith(`${cwdRealPath}${sep}`)) {
    throw new Error('Reflection directory must stay inside the project.')
  }
  return dir
}
