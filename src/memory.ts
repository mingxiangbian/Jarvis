import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

export async function loadInstructionsIfExists(cwd: string): Promise<string> {
  try {
    const content = await readFile(join(cwd, '.cc-local', 'instructions.md'), 'utf8')
    return `## Project Instructions\n\n${content}`
  } catch (error) {
    if (isMissingFileError(error)) {
      return ''
    }

    throw error
  }
}

export async function loadMemories(cwd: string): Promise<string> {
  const memoryDir = join(cwd, '.cc-local', 'memory')
  const cwdRealPath = await realpath(cwd)
  const intendedCcLocalDir = join(cwdRealPath, '.cc-local')
  let memoryDirRealPath: string
  let index: string

  try {
    memoryDirRealPath = await realpath(memoryDir)
    if (!isPathInside(intendedCcLocalDir, memoryDirRealPath)) {
      return ''
    }

    index = await readFile(join(memoryDirRealPath, 'MEMORY.md'), 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) {
      return ''
    }

    throw error
  }

  const sections: string[] = []

  for (const line of index.split('\n')) {
    const match = line.match(/^- \[([^\]]+)\]\(([^)]+)\) — .+$/)
    if (!match) {
      continue
    }

    const [, title, filename] = match
    const memoryFilePath = resolve(memoryDir, filename)
    if (!isPathInside(memoryDir, memoryFilePath)) {
      continue
    }

    try {
      const memoryFileRealPath = await realpath(memoryFilePath)
      if (!isPathInside(memoryDirRealPath, memoryFileRealPath)) {
        continue
      }

      const content = await readFile(memoryFileRealPath, 'utf8')
      sections.push(`## Memory: ${title}\n\n${content.trim()}`)
    } catch (error) {
      if (isMissingFileError(error)) {
        continue
      }

      throw error
    }
  }

  return sections.join('\n\n')
}

export async function loadRecentSummaries(cwd: string, count: number): Promise<string> {
  if (count <= 0) {
    return ''
  }

  const sessionsDir = join(cwd, '.cc-local', 'memory', 'sessions')
  const cwdRealPath = await realpath(cwd)
  const intendedCcLocalDir = join(cwdRealPath, '.cc-local')
  let sessionsDirRealPath: string
  let files: string[]

  try {
    sessionsDirRealPath = await realpath(sessionsDir)
    if (!isPathInside(intendedCcLocalDir, sessionsDirRealPath)) {
      return ''
    }

    files = await readdir(sessionsDirRealPath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return ''
    }

    throw error
  }

  const sessionFiles = files
    .filter((file) => file.endsWith('.md'))
    .sort(compareSessionFilenames)

  if (sessionFiles.length === 0) {
    return ''
  }

  const sections: string[] = []

  for (let index = sessionFiles.length - 1; index >= 0 && sections.length < count; index--) {
    const file = sessionFiles[index]
    const sessionFilePath = join(sessionsDirRealPath, file)

    try {
      const sessionFileStats = await lstat(sessionFilePath)
      if (sessionFileStats.isSymbolicLink()) {
        continue
      }

      const sessionFileRealPath = await realpath(sessionFilePath)
      if (!isPathInside(sessionsDirRealPath, sessionFileRealPath)) {
        continue
      }

      const content = await readFile(sessionFileRealPath, 'utf8')
      sections.push(`## Previous Session: ${file.replace('.md', '')}\n\n${content.trim()}`)
    } catch (error) {
      if (isMissingFileError(error)) {
        continue
      }

      throw error
    }
  }

  return sections.reverse().join('\n\n')
}

export async function saveSessionSummary(cwd: string, content: string): Promise<void> {
  const memoryDir = await getWritableMemoryDir(cwd)
  const sessionsDir = await ensureWritableDirectory(join(memoryDir, 'sessions'), memoryDir)
  await writeAvailableSessionFile(sessionsDir, new Date().toISOString().slice(0, 10), content)
}

export async function updateMemoryIndex(
  cwd: string,
  entry: { title: string; file: string; summary: string }
): Promise<void> {
  validateMemoryIndexEntry(entry)

  const memoryDir = await getWritableMemoryDir(cwd)
  const memoryIndexPath = await getWritableFilePath(join(memoryDir, 'MEMORY.md'), memoryDir)
  let prefix = ''

  try {
    const existingIndex = await readFile(memoryIndexPath, 'utf8')
    prefix = existingIndex === '' || existingIndex.endsWith('\n') ? '' : '\n'
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }

  await appendNoFollow(memoryIndexPath, `${prefix}- [${entry.title}](${entry.file}) — ${entry.summary}\n`)
}

async function getWritableMemoryDir(cwd: string): Promise<string> {
  const cwdRealPath = await realpath(cwd)
  const ccLocalDir = await ensureWritableDirectory(join(cwdRealPath, '.cc-local'), cwdRealPath)
  return ensureWritableDirectory(join(ccLocalDir, 'memory'), ccLocalDir)
}

async function ensureWritableDirectory(dirPath: string, parentRealPath: string): Promise<string> {
  try {
    return await getWritableDirectory(dirPath, parentRealPath)
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }

    try {
      await mkdir(dirPath)
    } catch (mkdirError) {
      if (!isFileErrorCode(mkdirError, 'EEXIST')) {
        throw mkdirError
      }
    }

    return getWritableDirectory(dirPath, parentRealPath)
  }
}

async function getWritableDirectory(dirPath: string, parentRealPath: string): Promise<string> {
  const stats = await lstat(dirPath)
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to write memory through symlink: ${dirPath}`)
  }

  if (!stats.isDirectory()) {
    throw new Error(`Refusing to write memory through non-directory path: ${dirPath}`)
  }

  const dirRealPath = await realpath(dirPath)
  if (!isPathInside(parentRealPath, dirRealPath)) {
    throw new Error(`Refusing to write memory outside project: ${dirPath}`)
  }

  return dirRealPath
}

async function getWritableFilePath(filePath: string, parentRealPath: string): Promise<string> {
  try {
    const stats = await lstat(filePath)
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to write memory through symlink: ${filePath}`)
    }

    if (!stats.isFile()) {
      throw new Error(`Refusing to write memory through non-file path: ${filePath}`)
    }

    const fileRealPath = await realpath(filePath)
    if (!isPathInside(parentRealPath, fileRealPath)) {
      throw new Error(`Refusing to write memory outside project: ${filePath}`)
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }

  return filePath
}

async function writeAvailableSessionFile(sessionsDir: string, date: string, content: string): Promise<void> {
  for (let suffix = 0; ; suffix++) {
    const filename = suffix === 0 ? `${date}.md` : `${date}-${suffix}.md`
    const filePath = join(sessionsDir, filename)

    try {
      await writeFile(filePath, content, { flag: 'wx' })
      return
    } catch (error) {
      if (isFileErrorCode(error, 'EEXIST')) {
        await assertWritableExistingFile(filePath, sessionsDir)
        continue
      }

      throw error
    }
  }
}

async function assertWritableExistingFile(filePath: string, parentRealPath: string): Promise<void> {
  try {
    const stats = await lstat(filePath)
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to write memory through symlink: ${filePath}`)
    }

    if (!stats.isFile()) {
      throw new Error(`Refusing to write memory through non-file path: ${filePath}`)
    }

    const fileRealPath = await realpath(filePath)
    if (!isPathInside(parentRealPath, fileRealPath)) {
      throw new Error(`Refusing to write memory outside project: ${filePath}`)
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return
    }

    throw error
  }
}

async function appendNoFollow(filePath: string, content: string): Promise<void> {
  const file = await open(
    filePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW
  )

  try {
    await file.writeFile(content)
  } finally {
    await file.close()
  }
}

function validateMemoryIndexEntry(entry: { title: string; file: string; summary: string }): void {
  for (const value of [entry.title, entry.file, entry.summary]) {
    if (value.includes('\n') || value.includes('\r')) {
      throw new Error('Memory index entries cannot contain newlines')
    }
  }
}

function compareSessionFilenames(left: string, right: string): number {
  const leftSession = parseSessionFilename(left)
  const rightSession = parseSessionFilename(right)

  if (!leftSession || !rightSession) {
    return left.localeCompare(right)
  }

  const dateComparison = leftSession.date.localeCompare(rightSession.date)
  if (dateComparison !== 0) {
    return dateComparison
  }

  return leftSession.suffix - rightSession.suffix
}

function parseSessionFilename(filename: string): { date: string; suffix: number } | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.md$/)
  if (!match) {
    return null
  }

  return { date: match[1], suffix: match[2] === undefined ? 0 : Number(match[2]) }
}

function isMissingFileError(error: unknown): boolean {
  return isFileErrorCode(error, 'ENOENT')
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}
