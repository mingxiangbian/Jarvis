import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatMessage } from '../llm-client.js'
import { traceRunDir } from './trace-store.js'

export async function loadTraceMessages(cwd: string, runId: string): Promise<ChatMessage[]> {
  const path = join(traceRunDir(cwd, runId), 'messages.jsonl')
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isObject(error) && error.code === 'ENOENT') {
      throw new Error(`Trace run not found: ${runId}`)
    }
    throw error
  }

  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => parseTraceMessageLine(line, runId))
}

export async function renderTraceReplay(cwd: string, runId: string): Promise<string> {
  const messages = await loadTraceMessages(cwd, runId)
  return messages
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n\n') + (messages.length === 0 ? '' : '\n')
}

function parseTraceMessageLine(line: string, runId: string): ChatMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(line) as unknown
  } catch {
    throw new Error(`Trace run is corrupt: ${runId}`)
  }
  if (!isObject(parsed) || !isObject(parsed.message)) {
    throw new Error(`Trace run is corrupt: ${runId}`)
  }
  const message = parsed.message
  if (
    (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'tool') ||
    typeof message.content !== 'string'
  ) {
    throw new Error(`Trace run is corrupt: ${runId}`)
  }
  return {
    role: message.role,
    content: message.content,
    ...(typeof message.tool_call_id === 'string' ? { tool_call_id: message.tool_call_id } : {}),
    ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls as ChatMessage['tool_calls'] } : {}),
    ...(isObject(message.providerMetadata)
      ? { providerMetadata: message.providerMetadata as ChatMessage['providerMetadata'] }
      : {})
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
