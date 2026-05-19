import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAgentRuntime } from '../src/web/prompt-context.js'

const originalHome = process.env.HOME
const tempHomes: string[] = []

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

describe('buildAgentRuntime', () => {
  it('builds shared config, system prompt, and core tools for an agent runtime', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cc-local-web-home-'))
    tempHomes.push(home)
    process.env.HOME = home

    const root = join(home, 'workspace', 'project')
    const userCcLocalDir = join(home, '.cc-local')

    await mkdir(join(root, '.cc-local', 'memory'), { recursive: true })
    await mkdir(join(home, 'workspace', '.cc-local'), { recursive: true })
    await mkdir(join(userCcLocalDir, 'memory'), { recursive: true })
    await writeFile(join(userCcLocalDir, 'soul.md'), 'Be direct.\n')
    await writeFile(join(userCcLocalDir, 'Rule.md'), 'Global rule.\n')
    await writeFile(join(home, 'workspace', '.cc-local', 'Rule.md'), 'Workspace rule.\n')
    await writeFile(join(root, '.cc-local', 'Rule.md'), 'Project rule.\n')
    await writeFile(join(root, '.cc-local', 'instructions.md'), 'Use TDD.\n')
    await writeFile(join(root, '.cc-local', 'memory', 'MEMORY.md'), '- [Code Style](style.md) — local style\n')
    await writeFile(join(root, '.cc-local', 'memory', 'style.md'), 'Prefer small patches.\n')
    await writeFile(join(userCcLocalDir, 'memory', 'MEMORY.md'), '- [Global Fact](global.md) — global fact\n')
    await writeFile(join(userCcLocalDir, 'memory', 'global.md'), 'Remember global fact.\n')
    await writeFile(join(root, '.cc-local', 'memory', 'daily.md'), 'recent one\nrecent two\n')

    const runtime = await buildAgentRuntime(root, new Date('2026-05-18T08:00:00.000Z'))

    expect(runtime.config.cwd).toBe(resolve(root))
    expect(runtime.config.writableRoots).toEqual([resolve(root)])

    const expectedOrder = [
      '# currentDate\nToday\'s date is 2026-05-18.',
      '## Global Persona\n\nBe direct.',
      '## Global Rule\n\nGlobal rule.',
      '## Rule:',
      'Workspace rule.',
      'Project rule.',
      '## Project Instructions\n\nUse TDD.',
      '## Project Memory: Code Style\n\nPrefer small patches.',
      '## Global Memory: Global Fact\n\nRemember global fact.',
      '## Recent Daily Memory\n\nrecent one\nrecent two'
    ]
    let lastIndex = -1
    for (const expected of expectedOrder) {
      const index = runtime.systemPrompt.indexOf(expected)
      expect(index).toBeGreaterThan(lastIndex)
      lastIndex = index
    }

    expect(runtime.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['file_read', 'file_write', 'file_edit', 'grep', 'glob', 'bash', 'ask_user'])
    )
  })
})
