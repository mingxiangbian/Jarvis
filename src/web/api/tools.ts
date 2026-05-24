import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadSession, updateSessionDisabledTools } from '../../session-store.js'
import type { Tool } from '../../tools/types.js'
import { controlError, controlOk, isObject, writeControlJson } from './types.js'

export type WebToolRisk = 'low' | 'medium' | 'high'
export type WebToolCost = 'none' | 'low' | 'medium' | 'high'
export type WebToolResourceLoad = 'low' | 'medium' | 'high'

export interface ToolsApiContext {
  cwd: string
  runtime: {
    tools: Tool<unknown>[]
  }
}

export interface WebToolManifestItem {
  name: string
  description: string
  risk: WebToolRisk
  cost: WebToolCost
  resourceLoad: WebToolResourceLoad
  isReadonly: boolean
  isDestructive: boolean
  needsUserInteraction: boolean
  enabledByConfig: boolean
  disabledForSession: boolean
}

export function filterToolsForSession(
  tools: Tool<unknown>[],
  disabledTools: string[] | undefined
): Tool<unknown>[] {
  const disabled = new Set(disabledTools ?? [])
  return tools.filter((tool) => !disabled.has(tool.name))
}

export async function getTools(
  response: ServerResponse,
  context: ToolsApiContext,
  sessionId: string | undefined
): Promise<void> {
  const disabledTools = await disabledToolsForSession(context.cwd, sessionId)
  writeControlJson(response, 200, controlOk({
    tools: context.runtime.tools.map((tool): WebToolManifestItem => ({
      name: tool.name,
      description: tool.description,
      risk: riskForTool(tool),
      cost: costForTool(tool.name, tool),
      resourceLoad: resourceLoadForTool(tool.name),
      isReadonly: tool.isReadonly,
      isDestructive: tool.isDestructive,
      needsUserInteraction: tool.needsUserInteraction,
      enabledByConfig: true,
      disabledForSession: disabledTools.has(tool.name)
    }))
  }))
}

export async function patchSessionTools(
  request: IncomingMessage,
  response: ServerResponse,
  context: ToolsApiContext,
  sessionId: string,
  readRequestBody: (request: IncomingMessage) => Promise<string>
): Promise<void> {
  let body: unknown
  try {
    body = JSON.parse(await readRequestBody(request))
  } catch (error) {
    writeControlJson(
      response,
      isRequestBodyTooLargeError(error) ? 413 : 400,
      controlError(isRequestBodyTooLargeError(error) ? 'Request body too large.' : 'Invalid JSON body.')
    )
    return
  }

  if (!isObject(body) || !Array.isArray(body.disabledTools) || !body.disabledTools.every((tool) => typeof tool === 'string')) {
    writeControlJson(response, 400, controlError('disabledTools must be an array of tool names.'))
    return
  }

  const enabledTools = new Set(context.runtime.tools.map((tool) => tool.name))
  const unavailableTool = body.disabledTools.find((tool) => !enabledTools.has(tool))
  if (unavailableTool !== undefined) {
    writeControlJson(
      response,
      422,
      controlError(
        'Tool is disabled by config and cannot be enabled for this session.',
        `Unavailable tool: ${unavailableTool}`
      )
    )
    return
  }

  try {
    const session = await updateSessionDisabledTools({
      cwd: context.cwd,
      sessionId,
      disabledTools: body.disabledTools
    })
    if (session === null) {
      writeControlJson(response, 404, controlError('Session not found.'))
      return
    }
    writeControlJson(response, 200, controlOk({ session }))
  } catch (error) {
    if (isUnsafeSessionError(error)) {
      writeControlJson(response, 400, controlError('Invalid session id.'))
      return
    }
    throw error
  }
}

async function disabledToolsForSession(cwd: string, sessionId: string | undefined): Promise<Set<string>> {
  if (sessionId === undefined) {
    return new Set()
  }
  try {
    const loaded = await loadSession({ cwd, sessionId, recentMessages: 0 })
    return new Set(loaded?.session.disabledTools ?? [])
  } catch (error) {
    if (isUnsafeSessionError(error)) {
      return new Set()
    }
    throw error
  }
}

function riskForTool(tool: Tool<unknown>): WebToolRisk {
  if (tool.isDestructive) return 'high'
  if (tool.needsUserInteraction || !tool.isReadonly) return 'medium'
  return 'low'
}

function costForTool(name: string, tool: Tool<unknown>): WebToolCost {
  if (name === 'web_search') return 'medium'
  if (tool.isReadonly) return 'none'
  return 'low'
}

function resourceLoadForTool(name: string): WebToolResourceLoad {
  return name === 'bash' ? 'medium' : 'low'
}

function isUnsafeSessionError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Unsafe session id:')
}

function isRequestBodyTooLargeError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Request body too large.'
}

