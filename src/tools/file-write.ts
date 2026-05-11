import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import type { Tool } from './types.js'

const schema = z.object({
  file_path: z.string().min(1),
  content: z.string()
})

function resolveFromCwd(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
}

function isUnderRoot(path: string, root: string): boolean {
  const relativePath = relative(root, path)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

async function canonicalWritableRoots(roots: string[]): Promise<string[]> {
  return Promise.all(roots.map((root) => realpath(root)))
}

function configuredWritableRoots(roots: string[]): string[] {
  return roots.map((root) => resolve(root))
}

function isUnderWritableRoot(path: string, roots: string[]): boolean {
  return roots.some((root) => isUnderRoot(path, root))
}

async function nearestExistingCanonicalParent(parent: string): Promise<string> {
  let current = parent

  while (true) {
    try {
      return await realpath(current)
    } catch {
      const next = dirname(current)
      if (next === current) {
        throw new Error(`No existing parent for ${parent}`)
      }
      current = next
    }
  }
}

type ExistingPath =
  | { kind: 'missing' }
  | { kind: 'non-symlink' }
  | { kind: 'symlink'; target: string | null }

async function inspectExistingPath(path: string): Promise<ExistingPath> {
  try {
    const stats = await lstat(path)
    if (!stats.isSymbolicLink()) {
      return { kind: 'non-symlink' }
    }

    try {
      return { kind: 'symlink', target: await realpath(path) }
    } catch {
      return { kind: 'symlink', target: null }
    }
  } catch {
    return { kind: 'missing' }
  }
}

export const fileWriteTool: Tool<z.infer<typeof schema>> = {
  name: 'file_write',
  description: 'Create or overwrite a UTF-8 text file inside a configured writable root.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path or path relative to the current working directory.' },
      content: { type: 'string', description: 'Complete file content to write.' }
    },
    required: ['file_path', 'content'],
    additionalProperties: false
  },
  schema,
  isReadonly: false,
  isDestructive: true,
  isConcurrencySafe: false,
  needsUserInteraction: false,
  async execute(args, context) {
    const resolved = resolveFromCwd(context.config.cwd, args.file_path)
    const configuredRoots = configuredWritableRoots(context.config.writableRoots)
    const writableRoots = await canonicalWritableRoots(context.config.writableRoots)

    if (!isUnderWritableRoot(resolved, [...configuredRoots, ...writableRoots])) {
      return { ok: false, content: `Refusing to write ${resolved}: outside writable roots.` }
    }

    const parent = dirname(resolved)
    const existingParent = await nearestExistingCanonicalParent(parent)
    if (!isUnderWritableRoot(existingParent, writableRoots)) {
      return { ok: false, content: `Refusing to write ${resolved}: outside writable roots.` }
    }

    await mkdir(parent, { recursive: true })
    const canonicalParent = await realpath(parent)

    if (!isUnderWritableRoot(canonicalParent, writableRoots)) {
      return { ok: false, content: `Refusing to write ${resolved}: outside writable roots.` }
    }

    const existingPath = await inspectExistingPath(resolved)
    if (existingPath.kind === 'symlink' && existingPath.target === null) {
      return { ok: false, content: `Refusing to write ${resolved}: symlink target cannot be resolved.` }
    }
    if (existingPath.kind === 'symlink' && existingPath.target && !isUnderWritableRoot(existingPath.target, writableRoots)) {
      return { ok: false, content: `Refusing to write ${resolved}: outside writable roots.` }
    }

    await writeFile(resolved, args.content, 'utf8')
    const canonical = await realpath(resolved)
    context.trackedFiles.add(canonical)

    return { ok: true, content: `Wrote ${canonical}` }
  }
}
