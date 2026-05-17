import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { getWritableMemoryDir } from './memory.js'

export interface ToolFactInput {
  toolName: string
  argumentsText: string
  ok: boolean
  content: string
  now?: Date
}

export function extractFactFromToolCall(input: ToolFactInput): string | null {
  if (input.toolName === 'ask_user') {
    return null
  }

  const args = parseArguments(input.argumentsText)
  const status = input.ok ? 'ok' : 'failed'
  const summary = summarizeToolCall(input.toolName, args, status, input.content)
  return `[${formatTime(input.now ?? new Date())}] ${input.toolName} -> ${summary}`
}

export async function appendDaily(cwd: string, chunks: string[]): Promise<void> {
  const nonEmptyChunks = chunks.map((chunk) => chunk.trim()).filter(Boolean)
  if (nonEmptyChunks.length === 0) {
    return
  }

  const memoryDir = await getWritableMemoryDir(cwd)
  const dailyPath = join(memoryDir, 'daily.md')
  const file = await open(
    dailyPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW
  )

  try {
    await file.writeFile(`${nonEmptyChunks.join('\n')}\n`)
  } finally {
    await file.close()
  }
}

function summarizeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  status: 'ok' | 'failed',
  content: string
): string {
  if (toolName === 'bash') {
    const exitCode = content.match(/Exit code:\s*([^\n]+)/)?.[1]?.trim()
    const command = readString(args.command)
    const result = [status, exitCode ? `exit ${exitCode}` : ''].filter(Boolean).join(' ')
    return command === '' ? result : `${result}: ${command}`
  }

  if (toolName === 'file_edit' || toolName === 'file_write' || toolName === 'file_read') {
    return [status, readString(args.file_path)].filter(Boolean).join(' ')
  }

  if (toolName === 'web_search') {
    return [status, readString(args.query)].filter(Boolean).join(' ')
  }

  return status
}

function parseArguments(argumentsText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsText) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
}

function formatTime(date: Date): string {
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}
