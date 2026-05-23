import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadRuleStack, loadSoul } from '../src/memory.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-persona-rules-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('persona and rule loading', () => {
  it('loads global and project Soul.md files', async () => {
    const home = await createTempDir()
    const userCyreneDir = join(home, '.cyrene')
    const project = join(home, 'workspace', 'project')
    await mkdir(join(project, '.cyrene'), { recursive: true })
    await mkdir(userCyreneDir, { recursive: true })
    await writeFile(join(userCyreneDir, 'Soul.md'), 'Be concise.\n')
    await writeFile(join(project, '.cyrene', 'Soul.md'), 'Prefer local context.\n')

    await expect(loadSoul(userCyreneDir, project)).resolves.toBe(
      ['## Global Persona\n\nBe concise.', `## Persona: ${await realpath(project)}\n\nPrefer local context.`].join('\n\n')
    )
  })

  it('loads legacy lowercase global soul files', async () => {
    const home = await createTempDir()
    const userCyreneDir = join(home, '.cyrene')
    await mkdir(userCyreneDir, { recursive: true })
    await writeFile(join(userCyreneDir, 'soul.md'), 'Be concise.\n')

    await expect(loadSoul(userCyreneDir)).resolves.toBe('## Global Persona\n\nBe concise.')
  })

  it('loads global and project Rule.md files from broadest to narrowest', async () => {
    const home = await createTempDir()
    const userCyreneDir = join(home, '.cyrene')
    const workspace = join(home, 'workspace')
    const project = join(workspace, 'project')
    await mkdir(userCyreneDir, { recursive: true })
    await mkdir(join(workspace, '.cyrene'), { recursive: true })
    await mkdir(join(project, '.cyrene'), { recursive: true })
    await writeFile(join(userCyreneDir, 'Rule.md'), 'Global rule.\n')
    await writeFile(join(workspace, '.cyrene', 'Rule.md'), 'Workspace rule.\n')
    await writeFile(join(project, '.cyrene', 'Rule.md'), 'Project rule.\n')

    await expect(loadRuleStack(project, userCyreneDir)).resolves.toBe(
      [
        '## Global Rule\n\nGlobal rule.',
        `## Rule: ${await realpath(workspace)}\n\nWorkspace rule.`,
        `## Rule: ${await realpath(project)}\n\nProject rule.`
      ].join('\n\n')
    )
  })

  it('ignores empty and symlinked Rule.md files', async () => {
    const home = await createTempDir()
    const outside = await createTempDir()
    const userCyreneDir = join(home, '.cyrene')
    const project = join(home, 'project')
    await mkdir(userCyreneDir, { recursive: true })
    await mkdir(join(project, '.cyrene'), { recursive: true })
    await writeFile(join(userCyreneDir, 'Rule.md'), '\n')
    await writeFile(join(outside, 'Rule.md'), 'Do not load symlink.\n')
    await symlink(join(outside, 'Rule.md'), join(project, '.cyrene', 'Rule.md'))

    await expect(loadRuleStack(project, userCyreneDir)).resolves.toBe('')
  })
})
