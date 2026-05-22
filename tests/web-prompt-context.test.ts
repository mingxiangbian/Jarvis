import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAgentRuntime } from '../src/web/prompt-context.js'

const originalHome = process.env.HOME
const originalTimeZone = process.env.TZ
const tempHomes: string[] = []

afterEach(async () => {
  process.env.HOME = originalHome
  process.env.TZ = originalTimeZone
  await Promise.all(tempHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

describe('buildAgentRuntime', () => {
  it('builds shared config, system prompt, and core tools for an agent runtime', async () => {
    const home = await mkdtemp(join(tmpdir(), 'jarvis-web-home-'))
    tempHomes.push(home)
    process.env.HOME = home
    process.env.TZ = 'Asia/Shanghai'

    const root = join(home, 'workspace', 'project')
    const userJarvisDir = join(home, '.jarvis')

    await mkdir(join(root, '.jarvis', 'memory'), { recursive: true })
    await mkdir(join(home, 'workspace', '.jarvis'), { recursive: true })
    await mkdir(join(userJarvisDir, 'memory'), { recursive: true })
    await writeFile(join(userJarvisDir, 'soul.md'), 'Be direct.\n')
    await writeFile(join(userJarvisDir, 'Rule.md'), 'Global rule.\n')
    await writeFile(join(home, 'workspace', '.jarvis', 'Rule.md'), 'Workspace rule.\n')
    await writeFile(join(root, '.jarvis', 'Rule.md'), 'Project rule.\n')
    await writeFile(join(root, '.jarvis', 'instructions.md'), 'Use TDD.\n')
    await writeFile(join(root, '.jarvis', 'memory', 'MEMORY.md'), '- [Code Style](style.md) — local style\n')
    await writeFile(join(root, '.jarvis', 'memory', 'style.md'), 'Prefer small patches.\n')
    await writeFile(join(userJarvisDir, 'memory', 'MEMORY.md'), '- [Global Fact](global.md) — global fact\n')
    await writeFile(join(userJarvisDir, 'memory', 'global.md'), 'Remember global fact.\n')
    await writeFile(join(root, '.jarvis', 'memory', 'daily.md'), 'recent one\nrecent two\n')

    const runtime = await buildAgentRuntime(root, new Date('2026-05-20T16:30:00.000Z'))

    expect(runtime.config.cwd).toBe(resolve(root))
    expect(runtime.config.writableRoots).toEqual([resolve(root)])

    const expectedOrder = [
      '# currentDate\nToday\'s date is 2026-05-21.',
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
