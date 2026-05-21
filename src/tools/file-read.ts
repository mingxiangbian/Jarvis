import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import type { Tool } from './types.js'

const schema = z.object({
  file_path: z.string().min(1)
})

function resolveFromCwd(cwd: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath)
}

function isUnderRoot(path: string, root: string): boolean {
  const relativePath = relative(root, path)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

async function isUnderReadableRoot(path: string, roots: string[]): Promise<boolean> {
  for (const root of roots) {
    if (isUnderRoot(path, await realpath(root))) {
      return true
    }
  }
  return false
}

function numberLines(content: string): string {
  const lines = content.split(/\r?\n/)
  return lines.map((line, index) => `${index + 1} | ${line}`).join('\n')
}

function numberLineRange(lines: string[], startLine: number): string[] {
  return lines.map((line, index) => `${startLine + index} | ${line}`)
}

export const fileReadTool: Tool<z.infer<typeof schema>> = {
  name: 'file_read',
  description: 'Read a UTF-8 text file. Returns content with line numbers and records the file as read for later edits.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path or path relative to the current working directory.' }
    },
    required: ['file_path'],
    additionalProperties: false
  },
  schema,
  isReadonly: true,
  isDestructive: false,
  isConcurrencySafe: false,
  needsUserInteraction: false,
  async execute(args, context) {
    const resolved = resolveFromCwd(context.config.cwd, args.file_path)

    try {
      const canonical = await realpath(resolved)
      if (!(await isUnderReadableRoot(canonical, context.config.readableRoots))) {
        return { ok: false, content: `Refusing to read ${canonical}: outside readable roots.` }
      }

      const content = await readFile(canonical, 'utf8')
      context.trackedFiles.add(canonical)

      const lineCount = content.split(/\r?\n/).length
      if (lineCount > context.config.readMaxInlineLines) {
        const lines = content.split(/\r?\n/)
        const tailStart = Math.max(lines.length - 50, 0)
        const compact = [
          ...numberLineRange(lines.slice(0, 100), 1),
          '[output compacted]',
          ...numberLineRange(lines.slice(tailStart), tailStart + 1)
        ].join('\n')
        return { ok: true, content: compact, metadata: { path: canonical, compacted: true } }
      }

      return { ok: true, content: numberLines(content), metadata: { path: canonical } }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, content: `Unable to read file ${resolved}: ${message}` }
    }
  }
}
