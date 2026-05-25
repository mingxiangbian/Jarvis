import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listMarkdownFiles,
  listWorkspaces,
  readMarkdownFile,
  resolveWorkspace
} from '../src/web/workspaces.js'

describe('web workspace helpers', () => {
  const tempRoots: string[] = []

  async function createTempRepo(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'web-workspaces-test-'))
    tempRoots.push(root)
    return root
  }

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('lists workspace root and direct child directories only', async () => {
    const repo = await createTempRepo()
    const rootName = basename(repo)
    await mkdir(join(repo, 'project-a', 'nested'), { recursive: true })
    await mkdir(join(repo, 'project-b'), { recursive: true })
    await mkdir(join(repo, 'project..a'), { recursive: true })
    await writeFile(join(repo, 'note.md'), '# root\n', 'utf8')

    await expect(listWorkspaces(repo)).resolves.toEqual([
      { id: '', label: rootName, relativePath: '.' },
      { id: 'project-a', label: `${rootName}/project-a`, relativePath: 'project-a' },
      { id: 'project-b', label: `${rootName}/project-b`, relativePath: 'project-b' }
    ])
  })

  it('returns a clear error when the workspace boundary is missing', async () => {
    const repo = await createTempRepo()

    await expect(listWorkspaces(join(repo, 'missing'))).rejects.toThrow('workspace root does not exist')
  })

  it('resolves root and a direct child workspace id', async () => {
    const repo = await createTempRepo()
    const rootName = basename(repo)
    await mkdir(join(repo, 'project-a'), { recursive: true })

    await expect(resolveWorkspace(repo, undefined)).resolves.toMatchObject({
      id: '',
      label: rootName,
      relativePath: '.'
    })
    await expect(resolveWorkspace(repo, '')).resolves.toMatchObject({
      id: '',
      label: rootName,
      relativePath: '.'
    })
    await expect(resolveWorkspace(repo, 'project-a')).resolves.toMatchObject({
      id: 'project-a',
      label: `${rootName}/project-a`,
      relativePath: 'project-a'
    })
  })

  it('rejects invalid workspace ids', async () => {
    const repo = await createTempRepo()
    await mkdir(join(repo, 'project-a', 'nested'), { recursive: true })
    await writeFile(join(repo, 'file-workspace'), 'not a directory\n', 'utf8')

    await expect(resolveWorkspace(repo, '../src')).rejects.toThrow('Invalid workspace id')
    await expect(resolveWorkspace(repo, '/tmp')).rejects.toThrow('Invalid workspace id')
    await expect(resolveWorkspace(repo, 'project-a/nested')).rejects.toThrow('Invalid workspace id')
    await expect(resolveWorkspace(repo, 'project..a')).rejects.toThrow('Invalid workspace id')
    await expect(resolveWorkspace(repo, 'file-workspace')).rejects.toThrow('Workspace is not a directory')
  })

  it('rejects workspace symlinks that escape workspace root', async () => {
    const repo = await createTempRepo()
    const outside = await createTempRepo()
    await symlink(outside, join(repo, 'linked'))

    await expect(resolveWorkspace(repo, 'linked')).rejects.toThrow('outside workspace root')
  })

  it('lists only top-level Markdown files in the selected workspace', async () => {
    const repo = await createTempRepo()
    await mkdir(join(repo, 'project-a', 'nested'), { recursive: true })
    await writeFile(join(repo, 'project-a', 'README.md'), '# readme\n', 'utf8')
    await writeFile(join(repo, 'project-a', 'notes.txt'), 'plain\n', 'utf8')
    await writeFile(join(repo, 'project-a', 'nested', 'deep.md'), '# deep\n', 'utf8')
    const workspace = await resolveWorkspace(repo, 'project-a')

    await expect(listMarkdownFiles(workspace)).resolves.toEqual([{ id: 'README.md', label: 'README.md' }])
  })

  it('excludes top-level Markdown files with invalid ids', async () => {
    const repo = await createTempRepo()
    await mkdir(join(repo, 'project-a'), { recursive: true })
    await writeFile(join(repo, 'project-a', 'README.md'), '# readme\n', 'utf8')
    await writeFile(join(repo, 'project-a', 'project..a.md'), '# invalid\n', 'utf8')
    const workspace = await resolveWorkspace(repo, 'project-a')

    await expect(listMarkdownFiles(workspace)).resolves.toEqual([{ id: 'README.md', label: 'README.md' }])
  })

  it('reads a valid top-level Markdown file from the selected workspace', async () => {
    const repo = await createTempRepo()
    await mkdir(join(repo, 'project-a'), { recursive: true })
    await writeFile(join(repo, 'project-a', 'README.md'), '# readme\n', 'utf8')
    const workspace = await resolveWorkspace(repo, 'project-a')

    await expect(readMarkdownFile(workspace, 'README.md')).resolves.toEqual({
      id: 'README.md',
      content: '# readme\n'
    })
  })

  it('rejects invalid Markdown file ids', async () => {
    const repo = await createTempRepo()
    await mkdir(join(repo, 'project-a'), { recursive: true })
    await writeFile(join(repo, 'project-a', 'notes.txt'), 'plain\n', 'utf8')
    const workspace = await resolveWorkspace(repo, 'project-a')

    await expect(readMarkdownFile(workspace, 'notes.txt')).rejects.toThrow('Markdown file id must end with .md')
    await expect(readMarkdownFile(workspace, '../README.md')).rejects.toThrow('Invalid Markdown file id')
    await expect(readMarkdownFile(workspace, '/tmp/README.md')).rejects.toThrow('Invalid Markdown file id')
    await expect(readMarkdownFile(workspace, 'nested/README.md')).rejects.toThrow('Invalid Markdown file id')
    await expect(readMarkdownFile(workspace, 'project..a.md')).rejects.toThrow('Invalid Markdown file id')
  })

  it('rejects Markdown symlinks that escape the active workspace', async () => {
    const repo = await createTempRepo()
    const outside = await createTempRepo()
    await mkdir(join(repo, 'project-a'), { recursive: true })
    await writeFile(join(outside, 'outside.md'), '# outside\n', 'utf8')
    await symlink(join(outside, 'outside.md'), join(repo, 'project-a', 'linked.md'))
    const workspace = await resolveWorkspace(repo, 'project-a')

    await expect(readMarkdownFile(workspace, 'linked.md')).rejects.toThrow('outside active workspace')
    await expect(readFile(join(outside, 'outside.md'), 'utf8')).resolves.toBe('# outside\n')
  })
})
