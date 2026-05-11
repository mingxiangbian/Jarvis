import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { glob } from 'tinyglobby'
import { z } from 'zod'
import type { Tool } from './types.js'

const schema = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1).optional(),
  include: z.string().min(1).optional()
})

export const grepTool: Tool<z.infer<typeof schema>> = {
  name: 'grep',
  description: 'Search UTF-8 text files for a JavaScript regular expression. Returns path, line number, and matching line.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'JavaScript regular expression.' },
      path: { type: 'string', description: 'Directory path relative to current working directory.' },
      include: { type: 'string', description: "Optional glob include such as '*.ts'." }
    },
    required: ['pattern'],
    additionalProperties: false
  },
  schema,
  isReadonly: true,
  isDestructive: false,
  isConcurrencySafe: false,
  needsUserInteraction: false,
  async execute(args, context) {
    let regex: RegExp
    try {
      regex = new RegExp(args.pattern)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, content: `Invalid regular expression: ${message}` }
    }

    const searchRoot = args.path ?? '.'
    const include = args.include ?? '**/*'
    const files = await glob(include, {
      cwd: resolve(context.config.cwd, searchRoot),
      absolute: true,
      onlyFiles: true,
      dot: true
    })

    const matches: string[] = []
    for (const file of files.sort()) {
      const content = await readFile(file, 'utf8').catch(() => '')
      const lines = content.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        if (regex.test(lines[index])) {
          matches.push(`${relative(context.config.cwd, file)}:${index + 1}: ${lines[index]}`)
          if (matches.length >= context.config.grepMaxMatches) {
            return { ok: true, content: matches.join('\n'), metadata: { truncated: true } }
          }
        }
      }
    }

    return { ok: true, content: matches.join('\n') || 'No matches.' }
  }
}
