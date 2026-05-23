import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'

export async function loadInstructionsIfExists(cwd: string): Promise<string> {
  const content = await readOptionalText(join(cwd, '.cyrene', 'instructions.md'))
  return content === '' ? '' : `## Project Instructions\n\n${content}`
}

export async function loadSoul(userCyreneDir: string, cwd?: string): Promise<string> {
  const sections: string[] = []
  const globalSoul = await readFirstOptionalText([join(userCyreneDir, 'Soul.md'), join(userCyreneDir, 'soul.md')])
  if (globalSoul !== '') {
    sections.push(`## Global Persona\n\n${globalSoul.trimEnd()}`)
  }

  if (cwd !== undefined) {
    const projectSoul = await readFirstOptionalText([join(cwd, '.cyrene', 'Soul.md'), join(cwd, '.cyrene', 'soul.md')])
    if (projectSoul !== '') {
      sections.push(`## Persona: ${await realpath(cwd)}\n\n${projectSoul.trimEnd()}`)
    }
  }

  return sections.join('\n\n')
}

export async function loadRuleStack(cwd: string, userCyreneDir: string): Promise<string> {
  const sections: string[] = []
  const globalRule = await readOptionalText(join(userCyreneDir, 'Rule.md'))
  if (globalRule !== '') {
    sections.push(`## Global Rule\n\n${globalRule.trimEnd()}`)
  }

  const cwdRealPath = await realpath(cwd)
  const globalCyreneParent = await realpath(dirname(userCyreneDir)).catch(() => undefined)
  const projectRuleSections: string[] = []
  let current = cwdRealPath
  while (true) {
    if (current !== globalCyreneParent) {
      const rule = await readOptionalText(join(current, '.cyrene', 'Rule.md'))
      if (rule !== '') {
        projectRuleSections.push(`## Rule: ${current}\n\n${rule.trimEnd()}`)
      }
    }

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  sections.push(...projectRuleSections.reverse())
  return sections.join('\n\n')
}

async function readFirstOptionalText(paths: string[]): Promise<string> {
  for (const path of paths) {
    const content = await readOptionalText(path)
    if (content !== '') return content
  }
  return ''
}

async function readOptionalText(filePath: string): Promise<string> {
  try {
    const stats = await lstat(filePath)
    if (stats.isSymbolicLink() || !stats.isFile()) return ''
    const content = await readFile(filePath, 'utf8')
    return content.trim() === '' ? '' : content
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) return ''
    throw error
  }
}

export function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
