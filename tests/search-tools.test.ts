import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/config.js'
import { globTool } from '../src/tools/glob.js'
import { grepTool } from '../src/tools/grep.js'

describe('search tools', () => {
  const tempRoots: string[] = []

  async function createTempRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), prefix))
    tempRoots.push(root)
    return root
  }

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('glob finds files with glob patterns', async () => {
    const root = await createTempRoot('glob-test-')
    await mkdir(join(root, 'src', 'nested'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1\n', 'utf8')
    await writeFile(join(root, 'src', 'nested', 'b.ts'), 'export const b = 2\n', 'utf8')
    await writeFile(join(root, 'src', 'note.md'), '# note\n', 'utf8')

    const result = await globTool.execute(
      { pattern: 'src/**/*.ts' },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(true)
    expect(result.content.split('\n')).toEqual(['src/a.ts', 'src/nested/b.ts'])
  })

  it('glob rejects parent directory traversal patterns', async () => {
    const parent = await createTempRoot('glob-traversal-test-')
    const root = join(parent, 'project')
    const sibling = join(parent, 'sibling')
    await mkdir(root, { recursive: true })
    await mkdir(sibling, { recursive: true })
    await writeFile(join(sibling, 'secret.txt'), 'secret\n', 'utf8')

    const result = await globTool.execute(
      { pattern: '../sibling/*.txt' },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('outside current working directory')
  })

  it('glob rejects absolute patterns outside cwd', async () => {
    const parent = await createTempRoot('glob-absolute-test-')
    const root = join(parent, 'project')
    const sibling = join(parent, 'sibling')
    await mkdir(root, { recursive: true })
    await mkdir(sibling, { recursive: true })
    await writeFile(join(sibling, 'secret.txt'), 'secret\n', 'utf8')

    const result = await globTool.execute(
      { pattern: join(sibling, '*.txt') },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('outside current working directory')
  })

  it('grep finds matching lines with path, line number, and line content', async () => {
    const root = await createTempRoot('grep-test-')
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), 'const token = "abc"\nconst other = true\n', 'utf8')

    const result = await grepTool.execute(
      { pattern: 'token', path: 'src', include: '*.ts' },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(true)
    expect(result.content).toBe('src/a.ts:1: const token = "abc"')
  })

  it('grep rejects parent directory traversal paths', async () => {
    const parent = await createTempRoot('grep-path-traversal-test-')
    const root = join(parent, 'project')
    const sibling = join(parent, 'sibling')
    await mkdir(root, { recursive: true })
    await mkdir(sibling, { recursive: true })
    await writeFile(join(sibling, 'secret.txt'), 'token\n', 'utf8')

    const result = await grepTool.execute(
      { pattern: 'token', path: '../sibling', include: '*.txt' },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('outside current working directory')
  })

  it('grep rejects parent directory traversal include patterns', async () => {
    const parent = await createTempRoot('grep-include-traversal-test-')
    const root = join(parent, 'project')
    const sibling = join(parent, 'sibling')
    await mkdir(root, { recursive: true })
    await mkdir(sibling, { recursive: true })
    await writeFile(join(sibling, 'secret.txt'), 'token\n', 'utf8')

    const result = await grepTool.execute(
      { pattern: 'token', include: '../**/*.txt' },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('outside current working directory')
  })

  it('grep caps output at config.grepMaxMatches and marks truncated results', async () => {
    const root = await createTempRoot('grep-limit-test-')
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), 'match one\nmatch two\nmatch three\n', 'utf8')

    const result = await grepTool.execute(
      { pattern: 'match', path: 'src', include: '*.ts' },
      {
        config: { ...createDefaultConfig(root), grepMaxMatches: 2 },
        trackedFiles: new Set<string>()
      }
    )

    expect(result.ok).toBe(true)
    expect(result.content.split('\n')).toHaveLength(2)
    expect(result.metadata?.truncated).toBe(true)
  })

  it('grep returns a controlled failure for invalid regex', async () => {
    const root = await createTempRoot('grep-regex-test-')

    const result = await grepTool.execute(
      { pattern: '[' },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('Invalid regular expression')
  })
})
