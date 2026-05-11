import { mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/config.js'
import { fileEditTool } from '../src/tools/file-edit.js'
import { fileWriteTool } from '../src/tools/file-write.js'

describe('file mutation tools', () => {
  const tempRoots: string[] = []

  async function createTempRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), prefix))
    tempRoots.push(root)
    return root
  }

  async function pathExists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('writes files under the configured writable root', async () => {
    const root = await createTempRoot('file-write-test-')
    const file = join(root, 'nested', 'created.txt')
    const trackedFiles = new Set<string>()

    const result = await fileWriteTool.execute(
      { file_path: file, content: 'hello\n' },
      { config: createDefaultConfig(root), trackedFiles }
    )

    expect(result.ok).toBe(true)
    expect(await readFile(file, 'utf8')).toBe('hello\n')
    expect([...trackedFiles]).toContain(await realpath(file))
  })

  it('resolves relative write paths under config cwd', async () => {
    const root = await createTempRoot('file-write-relative-test-')

    const result = await fileWriteTool.execute(
      { file_path: 'notes/created.txt', content: 'relative\n' },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(true)
    expect(await readFile(join(root, 'notes', 'created.txt'), 'utf8')).toBe('relative\n')
  })

  it('rejects writes outside the configured writable root', async () => {
    const root = await createTempRoot('file-write-root-test-')
    const outside = join(await createTempRoot('file-write-outside-test-'), 'outside.txt')

    const result = await fileWriteTool.execute(
      { file_path: outside, content: 'no\n' },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('outside writable roots')
    expect(await pathExists(outside)).toBe(false)
  })

  it('rejects path traversal outside the configured writable root', async () => {
    const root = await createTempRoot('file-write-traversal-test-')
    const outside = join(root, '..', 'outside.txt')

    const result = await fileWriteTool.execute(
      { file_path: outside, content: 'no\n' },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('outside writable roots')
    expect(await pathExists(outside)).toBe(false)
  })

  it('rejects symlink writes without creating outside directories', async () => {
    const root = await createTempRoot('file-write-symlink-root-test-')
    const outside = await createTempRoot('file-write-symlink-outside-test-')
    const link = join(root, 'link')
    const outsideCreatedDir = join(outside, 'new-dir')
    await symlink(outside, link)

    const result = await fileWriteTool.execute(
      { file_path: join(link, 'new-dir', 'file.txt'), content: 'no\n' },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('outside writable roots')
    expect(await pathExists(outsideCreatedDir)).toBe(false)
  })

  it('rejects symlinked file writes without changing outside targets', async () => {
    const root = await createTempRoot('file-write-file-symlink-root-test-')
    const outside = await createTempRoot('file-write-file-symlink-outside-test-')
    const outsideTarget = join(outside, 'target.txt')
    const link = join(root, 'link.txt')
    await writeFile(outsideTarget, 'original\n', 'utf8')
    await symlink(outsideTarget, link)

    const result = await fileWriteTool.execute(
      { file_path: link, content: 'changed\n' },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('outside writable roots')
    expect(await readFile(outsideTarget, 'utf8')).toBe('original\n')
  })

  it('rejects dangling symlinked file writes without creating outside targets', async () => {
    const root = await createTempRoot('file-write-dangling-symlink-root-test-')
    const outside = await createTempRoot('file-write-dangling-symlink-outside-test-')
    const outsideTarget = join(outside, 'missing-target.txt')
    const link = join(root, 'link.txt')
    await symlink(outsideTarget, link)

    const result = await fileWriteTool.execute(
      { file_path: link, content: 'changed\n' },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/Refusing|Unable to write|symlink/i)
    expect(await pathExists(outsideTarget)).toBe(false)
  })

  it('edits only after the file was read in this session', async () => {
    const root = await createTempRoot('file-edit-test-')
    const file = join(root, 'edit.txt')
    await writeFile(file, 'port=3000\n', 'utf8')

    const canonical = await realpath(file)
    const trackedFiles = new Set<string>([canonical])
    const result = await fileEditTool.execute(
      { file_path: file, old_string: 'port=3000', new_string: 'port=8080' },
      { config: createDefaultConfig(root), trackedFiles }
    )

    expect(result.ok).toBe(true)
    expect(await readFile(file, 'utf8')).toBe('port=8080\n')
  })

  it('rejects edit when the file was not read first', async () => {
    const root = await createTempRoot('file-edit-unread-test-')
    const file = join(root, 'edit.txt')
    await writeFile(file, 'port=3000\n', 'utf8')

    const result = await fileEditTool.execute(
      { file_path: file, old_string: 'port=3000', new_string: 'port=8080' },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>() }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('must read the file before editing')
    expect(await readFile(file, 'utf8')).toBe('port=3000\n')
  })

  it('rejects edit when old_string is not unique', async () => {
    const root = await createTempRoot('file-edit-unique-test-')
    const file = join(root, 'edit.txt')
    await writeFile(file, 'port=3000\nport=3000\n', 'utf8')

    const result = await fileEditTool.execute(
      { file_path: file, old_string: 'port=3000', new_string: 'port=8080' },
      { config: createDefaultConfig(root), trackedFiles: new Set<string>([await realpath(file)]) }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('Expected exactly one match')
    expect(await readFile(file, 'utf8')).toBe('port=3000\nport=3000\n')
  })
})
