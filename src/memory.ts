import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

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

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
