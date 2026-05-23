import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'

export interface WorkspaceInfo {
  id: string
  label: string
  relativePath: string
  absolutePath: string
}

export interface PublicWorkspaceInfo {
  id: string
  label: string
  relativePath: string
}

export interface MarkdownFileInfo {
  id: string
  label: string
}

export interface MarkdownFileContent {
  id: string
  content: string
}

export interface WorkspaceAsset {
  path: string
  contentType: string
}

const SUPPORTED_WORKSPACE_IMAGE_TYPES = new Map([
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
])

function publicWorkspace(workspace: WorkspaceInfo): PublicWorkspaceInfo {
  return {
    id: workspace.id,
    label: workspace.label,
    relativePath: workspace.relativePath
  }
}

function isInside(parent: string, child: string): boolean {
  const relativePath = relative(parent, child)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function hasPathSeparator(id: string): boolean {
  return id.includes('/') || id.includes('\\')
}

function hasParentTraversal(id: string): boolean {
  return id.includes('..')
}

function validateWorkspaceId(workspaceId: string | undefined): string {
  const id = workspaceId ?? ''
  if (id === '') return id
  if (id === '.' || hasParentTraversal(id) || isAbsolute(id) || hasPathSeparator(id)) {
    throw new Error(`Invalid workspace id: ${id}`)
  }
  return id
}

function validateMarkdownFileId(fileId: string): string {
  if (fileId === '' || fileId === '.' || hasParentTraversal(fileId) || isAbsolute(fileId) || hasPathSeparator(fileId)) {
    throw new Error(`Invalid Markdown file id: ${fileId}`)
  }
  if (!fileId.endsWith('.md')) {
    throw new Error('Markdown file id must end with .md')
  }
  return fileId
}

function validateWorkspaceAssetPath(assetPath: string): string {
  if (assetPath === '' || assetPath.includes('\\') || isAbsolute(assetPath)) {
    throw new Error('Invalid workspace asset path.')
  }

  const segments = assetPath.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Invalid workspace asset path.')
  }

  if (!SUPPORTED_WORKSPACE_IMAGE_TYPES.has(extname(assetPath).toLowerCase())) {
    throw new Error('Workspace asset must be a supported image file.')
  }

  return assetPath
}

async function canonicalWorkspaceRoot(repoCwd: string): Promise<string> {
  const workspaceRoot = resolve(repoCwd, 'workspace')
  try {
    const stats = await lstat(workspaceRoot)
    if (!stats.isDirectory()) {
      throw new Error(`workspace directory does not exist: ${workspaceRoot}`)
    }
    return await realpath(workspaceRoot)
  } catch (error) {
    if (error instanceof Error && error.message.includes('workspace directory does not exist')) {
      throw error
    }
    throw new Error(`workspace directory does not exist: ${workspaceRoot}`)
  }
}

export async function resolveWorkspace(repoCwd: string, workspaceId?: string): Promise<WorkspaceInfo> {
  const canonicalRoot = await canonicalWorkspaceRoot(repoCwd)
  const id = validateWorkspaceId(workspaceId)
  const candidate = id === '' ? canonicalRoot : resolve(canonicalRoot, id)

  let canonicalWorkspace: string
  try {
    canonicalWorkspace = await realpath(candidate)
  } catch {
    throw new Error(`Workspace does not exist: ${id || 'workspace'}`)
  }

  if (!isInside(canonicalRoot, canonicalWorkspace)) {
    throw new Error(`Workspace resolves outside workspace root: ${id}`)
  }

  const rootRelativePath = relative(canonicalRoot, canonicalWorkspace)
  if (id !== '' && (rootRelativePath === '' || hasPathSeparator(rootRelativePath))) {
    throw new Error(`Invalid workspace id: ${id}`)
  }

  const stats = await lstat(candidate)
  if (!stats.isDirectory()) {
    throw new Error(`Workspace is not a directory: ${id || 'workspace'}`)
  }

  return {
    id,
    label: id === '' ? 'workspace' : `workspace/${id}`,
    relativePath: id === '' ? 'workspace' : `workspace/${id}`,
    absolutePath: canonicalWorkspace
  }
}

export async function listWorkspaces(repoCwd: string): Promise<PublicWorkspaceInfo[]> {
  const root = await resolveWorkspace(repoCwd)
  const entries = await readdir(root.absolutePath, { withFileTypes: true })
  const childWorkspaces = entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        return [validateWorkspaceId(entry.name)]
      } catch {
        return []
      }
    })
    .sort((left, right) => left.localeCompare(right))
    .map((id) =>
      publicWorkspace({
        id,
        label: `workspace/${id}`,
        relativePath: `workspace/${id}`,
        absolutePath: resolve(root.absolutePath, id)
      })
    )

  return [publicWorkspace(root), ...childWorkspaces]
}

export async function listMarkdownFiles(workspace: WorkspaceInfo): Promise<MarkdownFileInfo[]> {
  const entries = await readdir(workspace.absolutePath, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .flatMap((entry) => {
      try {
        const id = validateMarkdownFileId(entry.name)
        return [{ id, label: id }]
      } catch {
        return []
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
}

export async function readMarkdownFile(workspace: WorkspaceInfo, fileId: string): Promise<MarkdownFileContent> {
  const id = validateMarkdownFileId(fileId)
  const filePath = resolve(workspace.absolutePath, id)
  const canonicalWorkspace = await realpath(workspace.absolutePath)

  let canonicalFile: string
  try {
    canonicalFile = await realpath(filePath)
  } catch {
    throw new Error(`Markdown file does not exist: ${id}`)
  }

  if (!isInside(canonicalWorkspace, canonicalFile)) {
    throw new Error(`Markdown file resolves outside active workspace: ${id}`)
  }
  if (basename(canonicalFile) !== id) {
    throw new Error(`Invalid Markdown file id: ${id}`)
  }

  const stats = await lstat(filePath)
  if (!stats.isFile()) {
    throw new Error(`Markdown file is not a regular file: ${id}`)
  }

  return {
    id,
    content: await readFile(canonicalFile, 'utf8')
  }
}

export async function resolveWorkspaceAsset(workspace: WorkspaceInfo, assetPath: string): Promise<WorkspaceAsset> {
  const safeAssetPath = validateWorkspaceAssetPath(assetPath)
  const filePath = resolve(workspace.absolutePath, safeAssetPath)
  const canonicalWorkspace = await realpath(workspace.absolutePath)

  let canonicalFile: string
  try {
    canonicalFile = await realpath(filePath)
  } catch {
    throw new Error(`Workspace asset does not exist: ${safeAssetPath}`)
  }

  if (!isInside(canonicalWorkspace, canonicalFile)) {
    throw new Error('Invalid workspace asset path.')
  }

  const stats = await lstat(canonicalFile)
  if (!stats.isFile()) {
    throw new Error(`Workspace asset is not a regular file: ${safeAssetPath}`)
  }

  return {
    path: canonicalFile,
    contentType: SUPPORTED_WORKSPACE_IMAGE_TYPES.get(extname(safeAssetPath).toLowerCase()) ?? 'application/octet-stream'
  }
}
