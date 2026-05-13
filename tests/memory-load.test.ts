import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMemories, loadRecentSummaries, saveSessionSummary, updateMemoryIndex } from '../src/memory.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-local-memory-'))
  tempDirs.push(dir)
  return dir
}

async function createMemoryDir(root: string): Promise<string> {
  const dir = join(root, '.cc-local', 'memory')
  await mkdir(dir, { recursive: true })
  return dir
}

async function createSessionsDir(root: string): Promise<string> {
  const dir = join(root, '.cc-local', 'memory', 'sessions')
  await mkdir(dir, { recursive: true })
  return dir
}

describe('loadMemories', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('returns an empty string when .cc-local/memory/ does not exist', async () => {
    const root = await createTempDir()

    await expect(loadMemories(root)).resolves.toBe('')
  })

  it('returns an empty string when .cc-local/memory is a symlink outside the project', async () => {
    const root = await createTempDir()
    const outsideMemoryDir = await createTempDir()
    await mkdir(join(root, '.cc-local'), { recursive: true })
    await writeFile(join(outsideMemoryDir, 'MEMORY.md'), '- [Outside](outside.md) — should not load\n')
    await writeFile(join(outsideMemoryDir, 'outside.md'), 'Do not load outside memory.\n')
    await symlink(outsideMemoryDir, join(root, '.cc-local', 'memory'))

    await expect(loadMemories(root)).resolves.toBe('')
  })

  it('returns an empty string when MEMORY.md is empty', async () => {
    const root = await createTempDir()
    const memoryDir = await createMemoryDir(root)
    await writeFile(join(memoryDir, 'MEMORY.md'), '')

    await expect(loadMemories(root)).resolves.toBe('')
  })

  it('loads and formats memory files referenced in MEMORY.md', async () => {
    const root = await createTempDir()
    const memoryDir = await createMemoryDir(root)
    await writeFile(
      join(memoryDir, 'MEMORY.md'),
      '- [Architecture](architecture.md) — agent loop notes\n- [Style](style.md) — coding style\n'
    )
    await writeFile(join(memoryDir, 'architecture.md'), 'Use small context windows.\n\n')
    await writeFile(join(memoryDir, 'style.md'), 'Keep edits surgical.\n')

    await expect(loadMemories(root)).resolves.toBe(
      '## Memory: Architecture\n\nUse small context windows.\n\n## Memory: Style\n\nKeep edits surgical.'
    )
  })

  it('skips malformed lines in MEMORY.md', async () => {
    const root = await createTempDir()
    const memoryDir = await createMemoryDir(root)
    await writeFile(
      join(memoryDir, 'MEMORY.md'),
      'not a memory entry\n- [Valid](valid.md) — useful summary\n- Missing bracket](invalid.md) — bad\n'
    )
    await writeFile(join(memoryDir, 'valid.md'), 'Load this one.\n')

    await expect(loadMemories(root)).resolves.toBe('## Memory: Valid\n\nLoad this one.')
  })

  it('skips memory files that do not exist', async () => {
    const root = await createTempDir()
    const memoryDir = await createMemoryDir(root)
    await writeFile(
      join(memoryDir, 'MEMORY.md'),
      '- [Missing](missing.md) — not present\n- [Existing](existing.md) — present\n'
    )
    await writeFile(join(memoryDir, 'existing.md'), 'Present memory.\n')

    await expect(loadMemories(root)).resolves.toBe('## Memory: Existing\n\nPresent memory.')
  })

  it('skips memory index entries whose paths escape .cc-local/memory', async () => {
    const root = await createTempDir()
    const memoryDir = await createMemoryDir(root)
    await writeFile(
      join(memoryDir, 'MEMORY.md'),
      '- [Outside](../../outside.md) — should not load\n- [Inside](inside.md) — should load\n'
    )
    await writeFile(join(root, 'outside.md'), 'Do not inject this content.\n')
    await writeFile(join(memoryDir, 'inside.md'), 'Load this memory.\n')

    await expect(loadMemories(root)).resolves.toBe('## Memory: Inside\n\nLoad this memory.')
  })

  it('skips symlinked memory files that resolve outside .cc-local/memory', async () => {
    const root = await createTempDir()
    const memoryDir = await createMemoryDir(root)
    await writeFile(
      join(memoryDir, 'MEMORY.md'),
      '- [Outside](link.md) — should not load\n- [Inside](inside.md) — should load\n'
    )
    await writeFile(join(root, 'outside.md'), 'Do not inject this symlinked content.\n')
    await symlink(join(root, 'outside.md'), join(memoryDir, 'link.md'))
    await writeFile(join(memoryDir, 'inside.md'), 'Load this memory.\n')

    await expect(loadMemories(root)).resolves.toBe('## Memory: Inside\n\nLoad this memory.')
  })
})

describe('loadRecentSummaries', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('returns an empty string when .cc-local/memory/sessions does not exist', async () => {
    const root = await createTempDir()

    await expect(loadRecentSummaries(root, 3)).resolves.toBe('')
  })

  it('returns an empty string when no session files exist', async () => {
    const root = await createTempDir()
    const sessionsDir = await createSessionsDir(root)
    await writeFile(join(sessionsDir, 'notes.txt'), 'Not a session summary.\n')

    await expect(loadRecentSummaries(root, 3)).resolves.toBe('')
  })

  it('returns an empty string when count is zero', async () => {
    const root = await createTempDir()
    const sessionsDir = await createSessionsDir(root)
    await writeFile(join(sessionsDir, '2026-05-12.md'), 'Do not load this summary.\n')

    await expect(loadRecentSummaries(root, 0)).resolves.toBe('')
  })

  it('loads the most recent N session summaries', async () => {
    const root = await createTempDir()
    const sessionsDir = await createSessionsDir(root)
    await writeFile(join(sessionsDir, '2026-05-10.md'), 'First summary.\n')
    await writeFile(join(sessionsDir, '2026-05-11.md'), 'Second summary.\n\n')
    await writeFile(join(sessionsDir, '2026-05-12.md'), 'Third summary.\n')

    await expect(loadRecentSummaries(root, 2)).resolves.toBe(
      '## Previous Session: 2026-05-11\n\nSecond summary.\n\n## Previous Session: 2026-05-12\n\nThird summary.'
    )
  })

  it('loads all summaries when fewer than count exist', async () => {
    const root = await createTempDir()
    const sessionsDir = await createSessionsDir(root)
    await writeFile(join(sessionsDir, '2026-05-11.md'), 'Second summary.\n')
    await writeFile(join(sessionsDir, '2026-05-12.md'), 'Third summary.\n')

    await expect(loadRecentSummaries(root, 5)).resolves.toBe(
      '## Previous Session: 2026-05-11\n\nSecond summary.\n\n## Previous Session: 2026-05-12\n\nThird summary.'
    )
  })

  it('loads only the latest same-day summary when count is one', async () => {
    const root = await createTempDir()
    const today = new Date().toISOString().slice(0, 10)

    await saveSessionSummary(root, 'First same-day summary.\n')
    await saveSessionSummary(root, 'Second same-day summary.\n')

    await expect(loadRecentSummaries(root, 1)).resolves.toBe(
      `## Previous Session: ${today}-1\n\nSecond same-day summary.`
    )
  })

  it('loads same-day summaries in chronological output order', async () => {
    const root = await createTempDir()
    const today = new Date().toISOString().slice(0, 10)

    await saveSessionSummary(root, 'First same-day summary.\n')
    await saveSessionSummary(root, 'Second same-day summary.\n')

    await expect(loadRecentSummaries(root, 2)).resolves.toBe(
      `## Previous Session: ${today}\n\nFirst same-day summary.\n\n## Previous Session: ${today}-1\n\nSecond same-day summary.`
    )
  })

  it('skips symlinked session files that resolve outside .cc-local/memory/sessions', async () => {
    const root = await createTempDir()
    const sessionsDir = await createSessionsDir(root)
    await writeFile(join(root, '2026-05-11.md'), 'Do not inject this symlinked summary.\n')
    await symlink(join(root, '2026-05-11.md'), join(sessionsDir, '2026-05-11.md'))
    await writeFile(join(sessionsDir, '2026-05-12.md'), 'Load this summary.\n')

    await expect(loadRecentSummaries(root, 2)).resolves.toBe(
      '## Previous Session: 2026-05-12\n\nLoad this summary.'
    )
  })

  it('backfills older valid summaries when a newer session symlink resolves outside sessions', async () => {
    const root = await createTempDir()
    const sessionsDir = await createSessionsDir(root)
    await writeFile(join(sessionsDir, '2026-05-10.md'), 'Older valid summary.\n')
    await writeFile(join(sessionsDir, '2026-05-11.md'), 'Newer valid summary.\n')
    await writeFile(join(root, '2026-05-12.md'), 'Do not inject this outside summary.\n')
    await symlink(join(root, '2026-05-12.md'), join(sessionsDir, '2026-05-12.md'))

    await expect(loadRecentSummaries(root, 2)).resolves.toBe(
      '## Previous Session: 2026-05-10\n\nOlder valid summary.\n\n## Previous Session: 2026-05-11\n\nNewer valid summary.'
    )
  })

  it('backfills older valid summaries when the newest session is an internal symlink', async () => {
    const root = await createTempDir()
    const sessionsDir = await createSessionsDir(root)
    await writeFile(join(sessionsDir, '2026-05-10.md'), 'Oldest valid summary.\n')
    await writeFile(join(sessionsDir, '2026-05-11.md'), 'Older valid summary.\n')
    await writeFile(join(sessionsDir, '2026-05-12.md'), 'Newest valid summary.\n')
    await symlink(join(sessionsDir, '2026-05-12.md'), join(sessionsDir, '2026-05-13.md'))

    await expect(loadRecentSummaries(root, 2)).resolves.toBe(
      '## Previous Session: 2026-05-11\n\nOlder valid summary.\n\n## Previous Session: 2026-05-12\n\nNewest valid summary.'
    )
  })
})

describe('saveSessionSummary', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('writes session summary to a date-named file, creating directories as needed', async () => {
    const root = await createTempDir()
    const content = 'Session summary.\n\nKeep this exact content.\n'

    await saveSessionSummary(root, content)

    const sessionsDir = join(root, '.cc-local', 'memory', 'sessions')
    const files = await readdir(sessionsDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.md$/)
    await expect(readFile(join(sessionsDir, files[0]), 'utf8')).resolves.toBe(content)
  })

  it('creates same-day session summaries without overwriting existing content', async () => {
    const root = await createTempDir()
    const firstContent = 'First session summary.\n'
    const secondContent = 'Second session summary.\n'
    const today = new Date().toISOString().slice(0, 10)

    await saveSessionSummary(root, firstContent)
    await saveSessionSummary(root, secondContent)

    const sessionsDir = join(root, '.cc-local', 'memory', 'sessions')
    const files = await readdir(sessionsDir)
    expect(new Set(files)).toEqual(new Set([`${today}.md`, `${today}-1.md`]))
    await expect(readFile(join(sessionsDir, `${today}.md`), 'utf8')).resolves.toBe(firstContent)
    await expect(readFile(join(sessionsDir, `${today}-1.md`), 'utf8')).resolves.toBe(secondContent)
  })

  it('preserves concurrent same-day session summaries in distinct files', async () => {
    const root = await createTempDir()
    const today = new Date().toISOString().slice(0, 10)
    const contents = Array.from({ length: 5 }, (_, index) => `Concurrent session summary ${index}.\n`)

    await Promise.all(contents.map((content) => saveSessionSummary(root, content)))

    const sessionsDir = join(root, '.cc-local', 'memory', 'sessions')
    const files = await readdir(sessionsDir)
    expect(new Set(files)).toEqual(
      new Set([`${today}.md`, `${today}-1.md`, `${today}-2.md`, `${today}-3.md`, `${today}-4.md`])
    )

    const savedContents = await Promise.all(files.map((file) => readFile(join(sessionsDir, file), 'utf8')))
    expect(new Set(savedContents)).toEqual(new Set(contents))
  })

  it('does not write session summary through a .cc-local/memory symlink outside the project', async () => {
    const root = await createTempDir()
    const outsideMemoryDir = await createTempDir()
    await mkdir(join(root, '.cc-local'), { recursive: true })
    await symlink(outsideMemoryDir, join(root, '.cc-local', 'memory'))

    let error: unknown
    try {
      await saveSessionSummary(root, 'Do not write outside.\n')
    } catch (caught) {
      error = caught
    }

    await expect(readdir(join(outsideMemoryDir, 'sessions'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(error).toBeInstanceOf(Error)
  })

  it('does not create session summary through a .cc-local symlink outside the project', async () => {
    const root = await createTempDir()
    const outsideCcLocalDir = await createTempDir()
    await symlink(outsideCcLocalDir, join(root, '.cc-local'))

    let error: unknown
    try {
      await saveSessionSummary(root, 'Do not write outside.\n')
    } catch (caught) {
      error = caught
    }

    await expect(readdir(join(outsideCcLocalDir, 'memory'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(error).toBeInstanceOf(Error)
  })

  it('does not write session summary through a sessions symlink outside the project', async () => {
    const root = await createTempDir()
    const memoryDir = await createMemoryDir(root)
    const outsideSessionsDir = await createTempDir()
    await symlink(outsideSessionsDir, join(memoryDir, 'sessions'))

    let error: unknown
    try {
      await saveSessionSummary(root, 'Do not write outside.\n')
    } catch (caught) {
      error = caught
    }

    const outsideFiles = await readdir(outsideSessionsDir)
    expect(outsideFiles).toHaveLength(0)
    expect(error).toBeInstanceOf(Error)
  })

  it('does not write session summary through today file symlink outside the project', async () => {
    const root = await createTempDir()
    const sessionsDir = await createSessionsDir(root)
    const outsideSessionFile = join(await createTempDir(), 'outside-session.md')
    const existingContent = 'Existing outside content.\n'
    const todayFile = `${new Date().toISOString().slice(0, 10)}.md`
    await writeFile(outsideSessionFile, existingContent)
    await symlink(outsideSessionFile, join(sessionsDir, todayFile))

    let error: unknown
    try {
      await saveSessionSummary(root, 'Do not write outside.\n')
    } catch (caught) {
      error = caught
    }

    await expect(readFile(outsideSessionFile, 'utf8')).resolves.toBe(existingContent)
    expect(error).toBeInstanceOf(Error)
  })
})

describe('updateMemoryIndex', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('creates MEMORY.md with entry when it does not exist, creating directories as needed', async () => {
    const root = await createTempDir()

    await updateMemoryIndex(root, {
      title: 'Architecture',
      file: 'architecture.md',
      summary: 'agent loop notes',
    })

    await expect(readFile(join(root, '.cc-local', 'memory', 'MEMORY.md'), 'utf8')).resolves.toBe(
      '- [Architecture](architecture.md) — agent loop notes\n'
    )
  })

  it('appends to existing MEMORY.md while preserving existing content', async () => {
    const root = await createTempDir()
    const memoryDir = await createMemoryDir(root)
    await writeFile(join(memoryDir, 'MEMORY.md'), '- [Existing](existing.md) — old notes\n')

    await updateMemoryIndex(root, {
      title: 'Style',
      file: 'style.md',
      summary: 'coding style',
    })

    await expect(readFile(join(memoryDir, 'MEMORY.md'), 'utf8')).resolves.toBe(
      '- [Existing](existing.md) — old notes\n- [Style](style.md) — coding style\n'
    )
  })

  it('inserts a newline before appending when existing MEMORY.md lacks a trailing newline', async () => {
    const root = await createTempDir()
    const memoryDir = await createMemoryDir(root)
    await writeFile(join(memoryDir, 'MEMORY.md'), '- [Existing](existing.md) — old notes')

    await updateMemoryIndex(root, {
      title: 'Style',
      file: 'style.md',
      summary: 'coding style',
    })

    await expect(readFile(join(memoryDir, 'MEMORY.md'), 'utf8')).resolves.toBe(
      '- [Existing](existing.md) — old notes\n- [Style](style.md) — coding style\n'
    )
  })

  it('rejects memory index entries containing CR or LF without changing MEMORY.md', async () => {
    const cases: Array<{ title: string; file: string; summary: string }> = [
      { title: 'Bad\ntitle', file: 'bad-title.md', summary: 'summary' },
      { title: 'Bad\rtitle', file: 'bad-title.md', summary: 'summary' },
      { title: 'Title', file: 'bad\nfile.md', summary: 'summary' },
      { title: 'Title', file: 'bad\rfile.md', summary: 'summary' },
      { title: 'Title', file: 'file.md', summary: 'bad\nsummary' },
      { title: 'Title', file: 'file.md', summary: 'bad\rsummary' },
    ]

    for (const entry of cases) {
      const root = await createTempDir()
      const memoryDir = await createMemoryDir(root)
      const memoryIndexPath = join(memoryDir, 'MEMORY.md')
      const existingIndex = '- [Existing](existing.md) — old notes\n'
      await writeFile(memoryIndexPath, existingIndex)

      await expect(updateMemoryIndex(root, entry)).rejects.toThrow(/newlines/)
      await expect(readFile(memoryIndexPath, 'utf8')).resolves.toBe(existingIndex)
    }
  })

  it('does not update memory index through a .cc-local/memory symlink outside the project', async () => {
    const root = await createTempDir()
    const outsideMemoryDir = await createTempDir()
    await mkdir(join(root, '.cc-local'), { recursive: true })
    await symlink(outsideMemoryDir, join(root, '.cc-local', 'memory'))

    let error: unknown
    try {
      await updateMemoryIndex(root, {
        title: 'Outside',
        file: 'outside.md',
        summary: 'should not write',
      })
    } catch (caught) {
      error = caught
    }

    await expect(readFile(join(outsideMemoryDir, 'MEMORY.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(error).toBeInstanceOf(Error)
  })

  it('does not create memory index through a .cc-local symlink outside the project', async () => {
    const root = await createTempDir()
    const outsideCcLocalDir = await createTempDir()
    await symlink(outsideCcLocalDir, join(root, '.cc-local'))

    let error: unknown
    try {
      await updateMemoryIndex(root, {
        title: 'Outside',
        file: 'outside.md',
        summary: 'should not write',
      })
    } catch (caught) {
      error = caught
    }

    await expect(readdir(join(outsideCcLocalDir, 'memory'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(error).toBeInstanceOf(Error)
  })

  it('does not update memory index through a MEMORY.md symlink outside the project', async () => {
    const root = await createTempDir()
    const memoryDir = await createMemoryDir(root)
    const outsideMemoryIndex = join(await createTempDir(), 'MEMORY.md')
    await writeFile(outsideMemoryIndex, '- [Existing](existing.md) — old notes\n')
    await symlink(outsideMemoryIndex, join(memoryDir, 'MEMORY.md'))

    let error: unknown
    try {
      await updateMemoryIndex(root, {
        title: 'Outside',
        file: 'outside.md',
        summary: 'should not write',
      })
    } catch (caught) {
      error = caught
    }

    await expect(readFile(outsideMemoryIndex, 'utf8')).resolves.toBe('- [Existing](existing.md) — old notes\n')
    expect(error).toBeInstanceOf(Error)
  })
})
