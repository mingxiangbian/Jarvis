import { relative } from 'node:path'
import { glob } from 'tinyglobby'
import { z } from 'zod'
import type { Tool } from './types.js'

const schema = z.object({
  pattern: z.string().min(1)
})

export const globTool: Tool<z.infer<typeof schema>> = {
  name: 'glob',
  description: 'Find files matching a glob pattern relative to the current working directory.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: "Glob pattern such as 'src/**/*.ts'." }
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
    const matches = await glob(args.pattern, {
      cwd: context.config.cwd,
      absolute: true,
      onlyFiles: true,
      dot: true
    })

    const output = matches.map((path) => relative(context.config.cwd, path)).sort().join('\n')
    return { ok: true, content: output || 'No files matched.' }
  }
}
