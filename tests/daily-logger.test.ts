import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendDaily, extractFactFromToolCall } from '../src/daily-logger.js'

const tempDirs: string[] = []
const now = new Date('2026-05-17T09:08:00Z')

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cc-local-daily-'))
  tempDirs.push(dir)
  return dir
}

describe('extractFactFromToolCall', () => {
  it('records successful bash command facts', () => {
    expect(
      extractFactFromToolCall({
        toolName: 'bash',
        argumentsText: '{"command":"npm test -- --run tests/config.test.ts"}',
        ok: true,
        content: 'Working directory: /tmp/project\nExit code: 0\nTimed out: no\nstdout:\npassed\nstderr:\n',
        now
      })
    ).toBe('[09:08] bash -> ok exit 0: npm test -- --run tests/config.test.ts')
  })

  it('records failed bash command facts', () => {
    expect(
      extractFactFromToolCall({
        toolName: 'bash',
        argumentsText: '{"command":"npm run missing"}',
        ok: false,
        content: 'Working directory: /tmp/project\nExit code: 1\nTimed out: no\nstdout:\n\nstderr:\nfailed',
        now
      })
    ).toBe('[09:08] bash -> failed exit 1: npm run missing')
  })

  it('records file edit, file write, and file read paths', () => {
    expect(
      extractFactFromToolCall({
        toolName: 'file_edit',
        argumentsText: '{"file_path":"src/main.ts"}',
        ok: true,
        content: 'Edited /tmp/project/src/main.ts',
        now
      })
    ).toBe('[09:08] file_edit -> ok src/main.ts')

    expect(
      extractFactFromToolCall({
        toolName: 'file_write',
        argumentsText: '{"file_path":"src/new.ts"}',
        ok: true,
        content: 'Wrote /tmp/project/src/new.ts',
        now
      })
    ).toBe('[09:08] file_write -> ok src/new.ts')

    expect(
      extractFactFromToolCall({
        toolName: 'file_read',
        argumentsText: '{"file_path":"src/config.ts"}',
        ok: true,
        content: '1 | export interface AppConfig',
        now
      })
    ).toBe('[09:08] file_read -> ok src/config.ts')
  })

  it('records web search query and unknown tool status', () => {
    expect(
      extractFactFromToolCall({
        toolName: 'web_search',
        argumentsText: '{"query":"OpenAI docs"}',
        ok: false,
        content: 'network unavailable',
        now
      })
    ).toBe('[09:08] web_search -> failed OpenAI docs')

    expect(
      extractFactFromToolCall({
        toolName: 'custom_tool',
        argumentsText: '{}',
        ok: true,
        content: 'custom output',
        now
      })
    ).toBe('[09:08] custom_tool -> ok')
  })

  it('skips ask_user and malformed arguments still produce a useful generic fact', () => {
    expect(
      extractFactFromToolCall({
        toolName: 'ask_user',
        argumentsText: '{"question":"Continue?"}',
        ok: true,
        content: 'yes',
        now
      })
    ).toBeNull()

    expect(
      extractFactFromToolCall({
        toolName: 'bash',
        argumentsText: '{bad json',
        ok: true,
        content: 'Exit code: 0',
        now
      })
    ).toBe('[09:08] bash -> ok exit 0')
  })
})

describe('appendDaily', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('creates memory directory and appends daily chunks without overwriting', async () => {
    const root = await createTempDir()

    await appendDaily(root, ['[09:08] bash -> ok exit 0'])
    await appendDaily(root, ['[09:09] file_read -> ok src/config.ts'])

    await expect(readFile(join(root, '.cc-local', 'memory', 'daily.md'), 'utf8')).resolves.toBe(
      '[09:08] bash -> ok exit 0\n[09:09] file_read -> ok src/config.ts\n'
    )
  })

  it('does nothing for empty chunks', async () => {
    const root = await createTempDir()

    await appendDaily(root, [])

    await expect(readFile(join(root, '.cc-local', 'memory', 'daily.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('refuses to append through a symlinked daily file', async () => {
    const root = await createTempDir()
    const outside = await createTempDir()
    const memoryDir = join(root, '.cc-local', 'memory')
    await mkdir(memoryDir, { recursive: true })
    await writeFile(join(outside, 'daily.md'), 'outside\n')
    await symlink(join(outside, 'daily.md'), join(memoryDir, 'daily.md'))

    await expect(appendDaily(root, ['[09:08] bash -> ok'])).rejects.toThrow(/symlink|ELOOP/)
    await expect(readFile(join(outside, 'daily.md'), 'utf8')).resolves.toBe('outside\n')
  })

  it('refuses to append through a symlinked .cc-local directory', async () => {
    const root = await createTempDir()
    const outsideCcLocal = await createTempDir()
    await symlink(outsideCcLocal, join(root, '.cc-local'))

    await expect(appendDaily(root, ['[09:08] bash -> ok'])).rejects.toThrow(/symlink/)
    await expect(readFile(join(outsideCcLocal, 'memory', 'daily.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
