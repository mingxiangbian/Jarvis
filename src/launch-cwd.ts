import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

export function resolveDefaultWebCwd(launchCwd: string): string {
  const cwd = resolve(launchCwd)
  if (isDirectory(join(cwd, 'workspace'))) {
    return cwd
  }

  const mainWorktree = resolveMainWorktreeFromLinkedWorktree(cwd)
  if (mainWorktree !== undefined && isDirectory(join(mainWorktree, 'workspace'))) {
    return mainWorktree
  }

  return cwd
}

function resolveMainWorktreeFromLinkedWorktree(cwd: string): string | undefined {
  const dotGitPath = join(cwd, '.git')
  if (!existsSync(dotGitPath) || isDirectory(dotGitPath)) {
    return undefined
  }

  let content: string
  try {
    content = readFileSync(dotGitPath, 'utf8')
  } catch {
    return undefined
  }

  const match = /^gitdir:\s*(.+)\s*$/m.exec(content)
  if (match === null) {
    return undefined
  }

  const gitDir = isAbsolute(match[1]) ? resolve(match[1]) : resolve(cwd, match[1])
  const worktreesDir = dirname(gitDir)
  const commonGitDir = dirname(worktreesDir)
  if (basename(worktreesDir) !== 'worktrees' || basename(commonGitDir) !== '.git') {
    return undefined
  }
  return dirname(commonGitDir)
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
