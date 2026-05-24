import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runAgentLoop } from '../agent-loop.js'
import { persistContinuitySnapshot } from '../affect/affect-runtime.js'
import { callModel as defaultCallModel, type CallModelInput, type ChatMessage, type ChatRole, type ModelResponse } from '../llm-client.js'
import { contextInfoForRoute } from '../models/provider-router.js'
import type { ModelContextInfo, ThinkingMode } from '../models/types.js'
import {
  appendSessionEvent,
  createSession,
  deleteSession,
  listSessions,
  loadSession,
  removeLastSessionMessage,
  updateSessionDisabledTools,
  updateSessionPinned,
  type SessionIndexItem
} from '../session-store.js'
import { createRunRecorder } from '../tracing/run-recorder.js'
import { createAffectCorrection } from './api/affect.js'
import {
  applyEvolutionProposal,
  approveEvolutionProposal,
  getEvolutionProposalDetail,
  getEvolutionProposals,
  rejectEvolutionProposal
} from './api/evolution.js'
import { archiveMemory, downrankMemory, getMemoryDetail, getMemoryList, strengthenMemory } from './api/memory.js'
import { filterToolsForSession, getTools, patchSessionTools } from './api/tools.js'
import { getTraceDetail, getTraceList } from './api/traces.js'
import { buildAgentRuntime } from './prompt-context.js'
import { createWebObserver, errorEvent, type WebRunEvent } from './web-observer.js'
import {
  listMarkdownFiles,
  listWorkspaces,
  readMarkdownFile,
  resolveWorkspaceAsset,
  resolveWorkspace,
  type WorkspaceInfo
} from './workspaces.js'

export interface StartWebServerInput {
  cwd: string
  memoryCwd?: string
  host: string
  port: number
  callModel?: (input: CallModelInput) => Promise<ModelResponse>
}

export interface WebServerHandle {
  url: string
  close: () => Promise<void>
}

interface RunRecord {
  id: string
  cwd: string
  memoryCwd: string
  workspace: WorkspaceInfo
  sessionId: string
  userMessage: ChatMessage
  messages: ChatMessage[]
  disabledTools?: string[]
  thinkingMode?: ThinkingMode
  modelContext: ModelContextInfo
  events: WebRunEvent[]
  clients: Set<ServerResponse>
  done: boolean
  cancelled: boolean
  createdSession: boolean
  abortController: AbortController
}

interface WebServerContext {
  cwd: string
  memoryCwd: string
  callModel?: (input: CallModelInput) => Promise<ModelResponse>
  runs: Map<string, RunRecord>
  activeRuns: Set<Promise<void>>
  runtime: Awaited<ReturnType<typeof buildAgentRuntime>>
}

const currentFile = fileURLToPath(import.meta.url)
const staticDir = resolve(dirname(currentFile), 'static')
const MAX_REQUEST_BODY_BYTES = 1_000_000

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body too large.')
  }
}

export async function startWebServer(input: StartWebServerInput): Promise<WebServerHandle> {
  const memoryCwd = input.memoryCwd ?? input.cwd
  const runtime = await buildAgentRuntime(input.cwd, new Date(), { memoryCwd })
  const runs = new Map<string, RunRecord>()
  const activeRuns = new Set<Promise<void>>()

  const server = createServer((request, response) => {
    void routeRequest(request, response, {
      activeRuns,
      callModel: input.callModel,
      cwd: input.cwd,
      memoryCwd,
      runs,
      runtime
    }).catch((error: unknown) => {
      if (!response.headersSent) {
        writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      } else {
        response.end()
      }
    })
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(input.port, input.host, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Web server did not bind to a TCP address.')
  }

  return {
    url: `http://${input.host}:${(address as AddressInfo).port}`,
    close: async () => {
      await new Promise<void>((resolveClose, rejectClose) => {
        for (const run of runs.values()) {
          for (const client of run.clients) {
            client.end()
          }
          run.clients.clear()
        }
        server.close((error) => {
          if (error) {
            rejectClose(error)
            return
          }
          resolveClose()
        })
      })
      await Promise.allSettled(activeRuns)
    }
  }
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: WebServerContext
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost')

  if (request.method === 'GET' && url.pathname === '/') {
    await serveStaticFile(response, 'index.html')
    return
  }

  if (request.method === 'GET' && url.pathname.startsWith('/static/')) {
    await serveStaticFile(response, url.pathname.slice('/static/'.length))
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/runs') {
    await createRun(request, response, context)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/control/tools') {
    await getTools(response, context, url.searchParams.get('sessionId') ?? undefined)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/control/memory') {
    await getMemoryList(response, context)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/control/affect/corrections') {
    await createAffectCorrection(request, response, context, readRequestBody)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/control/traces') {
    await getTraceList(response, context)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/control/evolution/proposals') {
    await getEvolutionProposals(response, context)
    return
  }

  const controlEvolutionMatch = /^\/api\/control\/evolution\/proposals\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname)
  if (controlEvolutionMatch !== null) {
    const proposalId = decodeRouteComponent(response, controlEvolutionMatch[1], 'proposal id')
    if (proposalId === undefined) return
    const action = controlEvolutionMatch[2]
    if (request.method === 'GET' && action === undefined) {
      await getEvolutionProposalDetail(response, context, proposalId)
      return
    }
    if (request.method === 'POST' && action === 'reject') {
      await rejectEvolutionProposal(response, context, proposalId)
      return
    }
    if (request.method === 'POST' && action === 'approve') {
      await approveEvolutionProposal(response, context, proposalId)
      return
    }
    if (request.method === 'POST' && action === 'apply') {
      await applyEvolutionProposal(response, context, proposalId)
      return
    }
  }

  const controlTraceMatch = /^\/api\/control\/traces\/([^/]+)$/.exec(url.pathname)
  if (request.method === 'GET' && controlTraceMatch !== null) {
    await getTraceDetail(response, context, controlTraceMatch[1])
    return
  }

  const controlMemoryMatch = /^\/api\/control\/memory\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname)
  if (controlMemoryMatch !== null) {
    const memoryId = decodeRouteComponent(response, controlMemoryMatch[1], 'memory id')
    if (memoryId === undefined) return
    const action = controlMemoryMatch[2]
    if (request.method === 'GET' && action === undefined) {
      await getMemoryDetail(response, context, memoryId)
      return
    }
    if (request.method === 'POST' && action === 'archive') {
      await archiveMemory(response, context, memoryId)
      return
    }
    if (request.method === 'POST' && action === 'downrank') {
      await downrankMemory(response, context, memoryId)
      return
    }
    if (request.method === 'POST' && action === 'strengthen') {
      await strengthenMemory(response, context, memoryId)
      return
    }
  }

  const controlSessionToolsMatch = /^\/api\/control\/sessions\/([^/]+)\/tools$/.exec(url.pathname)
  if (request.method === 'PATCH' && controlSessionToolsMatch !== null) {
    const sessionId = decodeSessionId(response, controlSessionToolsMatch[1])
    if (sessionId === undefined) return
    await patchSessionTools(request, response, context, sessionId, readRequestBody)
    return
  }

  const cancelRunMatch = /^\/api\/runs\/([^/]+)\/cancel$/.exec(url.pathname)
  if (request.method === 'POST' && cancelRunMatch !== null) {
    await cancelRun(response, context.runs, cancelRunMatch[1])
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/workspaces') {
    await getWorkspaces(response, context)
    return
  }

  const workspaceMarkdownMatch = /^\/api\/workspaces\/([^/]+)\/markdown$/.exec(url.pathname)
  if (request.method === 'GET' && workspaceMarkdownMatch !== null) {
    const workspaceId = decodeRouteWorkspaceId(response, workspaceMarkdownMatch[1])
    if (workspaceId === undefined) return
    await getWorkspaceMarkdown(response, context, workspaceId)
    return
  }

  const workspaceMarkdownFileMatch = /^\/api\/workspaces\/([^/]+)\/markdown\/([^/]+)$/.exec(url.pathname)
  if (request.method === 'GET' && workspaceMarkdownFileMatch !== null) {
    const workspaceId = decodeRouteWorkspaceId(response, workspaceMarkdownFileMatch[1])
    const fileId = decodeRouteComponent(response, workspaceMarkdownFileMatch[2], 'Markdown file id')
    if (workspaceId === undefined || fileId === undefined) return
    await getWorkspaceMarkdownFile(response, context, workspaceId, fileId)
    return
  }

  const workspaceAssetMatch = /^\/api\/workspaces\/([^/]+)\/files\/(.+)$/.exec(url.pathname)
  if (request.method === 'GET' && workspaceAssetMatch !== null) {
    const workspaceId = decodeRouteWorkspaceId(response, workspaceAssetMatch[1])
    const assetPath = decodeRouteComponent(response, workspaceAssetMatch[2], 'workspace asset path')
    if (workspaceId === undefined || assetPath === undefined) return
    await getWorkspaceAsset(response, context, workspaceId, assetPath)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/sessions') {
    await getSessions(response, context)
    return
  }

  const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname)
  if (sessionMatch !== null) {
    if (request.method === 'GET') {
      const sessionId = decodeSessionId(response, sessionMatch[1])
      if (sessionId === undefined) return
      await getSession(response, context, sessionId)
      return
    }
    if (request.method === 'PATCH') {
      const sessionId = decodeSessionId(response, sessionMatch[1])
      if (sessionId === undefined) return
      await patchSession(request, response, context, sessionId)
      return
    }
    if (request.method === 'DELETE') {
      const sessionId = decodeSessionId(response, sessionMatch[1])
      if (sessionId === undefined) return
      await deleteSessionRoute(response, context, sessionId)
      return
    }
  }

  const eventMatch = /^\/api\/runs\/([^/]+)\/events$/.exec(url.pathname)
  if (request.method === 'GET' && eventMatch !== null) {
    streamRunEvents(request, response, context.runs, eventMatch[1])
    return
  }

  writeJson(response, 404, { error: 'Not found.' })
}

async function createRun(
  request: IncomingMessage,
  response: ServerResponse,
  context: WebServerContext
): Promise<void> {
  let body: unknown
  try {
    body = JSON.parse(await readRequestBody(request))
  } catch (error) {
    writeJson(
      response,
      error instanceof RequestBodyTooLargeError ? 413 : 400,
      { error: error instanceof RequestBodyTooLargeError ? 'Request body too large.' : 'Invalid JSON body.' }
    )
    return
  }

  const parsed = parseRunRequest(body)
  if (!parsed.ok) {
    writeJson(response, 400, { error: parsed.error })
    return
  }

  const userMessage = parsed.message
  if (userMessage.content.trim().length === 0) {
    writeJson(response, 400, { error: 'At least one user message is required.' })
    return
  }

  let workspace: WorkspaceInfo
  try {
    workspace = await resolveWorkspace(context.cwd, parsed.workspaceId)
  } catch (error) {
    writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
    return
  }

  const runRuntime = await buildAgentRuntime(workspace.absolutePath, new Date(), {
    memoryCwd: context.memoryCwd,
    thinkingMode: parsed.thinkingMode
  })
  const modelContext = contextInfoForRoute(runRuntime.config, 'chat')
  const disabledToolsError = validateDisabledTools(parsed.disabledTools, runRuntime.tools.map((tool) => tool.name))
  if (disabledToolsError !== undefined) {
    writeJson(response, 422, { error: disabledToolsError })
    return
  }

  let session: SessionIndexItem
  let messages: ChatMessage[]
  try {
    if (parsed.sessionId === undefined) {
      session = await createSession({
        cwd: context.cwd,
        mode: 'web',
        model: modelContext.model,
        workspaceId: workspace.id,
        firstUserMessage: userMessage,
        disabledTools: parsed.disabledTools
      })
      messages = [userMessage]
    } else {
      const loaded = await loadSession({
        cwd: context.cwd,
        sessionId: parsed.sessionId,
        recentMessages: context.runtime.config.sessionResumeRecentMessages
      })
      if (loaded === null) {
        writeJson(response, 404, { error: 'Session not found.' })
        return
      }
      if (!isSessionWorkspaceCompatible(loaded.session, workspace.id)) {
        writeJson(response, 409, { error: 'Session workspace does not match requested workspace.' })
        return
      }
      await appendSessionEvent({
        cwd: context.cwd,
        sessionId: loaded.session.id,
        event: { type: 'message', message: userMessage }
      })
      session = parsed.disabledTools === undefined
        ? loaded.session
        : await updateSessionDisabledTools({
            cwd: context.cwd,
            sessionId: loaded.session.id,
            disabledTools: parsed.disabledTools
          }) ?? loaded.session
      messages = [...loaded.modelMessages, userMessage]
    }
  } catch (error) {
    if (isUnsafeSessionError(error)) {
      writeJson(response, 400, { error: 'Invalid session id.' })
      return
    }
    throw error
  }

  const record: RunRecord = {
    id: randomUUID(),
    cwd: context.cwd,
    memoryCwd: context.memoryCwd,
    workspace,
    sessionId: session.id,
    userMessage,
    messages,
    ...(session.disabledTools === undefined ? {} : { disabledTools: session.disabledTools }),
    thinkingMode: parsed.thinkingMode,
    modelContext,
    events: [],
    clients: new Set(),
    done: false,
    cancelled: false,
    createdSession: parsed.sessionId === undefined,
    abortController: new AbortController()
  }
  context.runs.set(record.id, record)
  writeJson(response, 202, { runId: record.id, sessionId: record.sessionId, modelContext: record.modelContext })

  const runPromise = Promise.resolve()
    .then(() => runWebAgent(record, context.callModel))
    .finally(() => {
      context.activeRuns.delete(runPromise)
    })
  context.activeRuns.add(runPromise)
}

async function runWebAgent(
  record: RunRecord,
  callModel?: (input: CallModelInput) => Promise<ModelResponse>
): Promise<void> {
  const recorder = await createRunRecorder({
    cwd: record.cwd,
    runId: record.id,
    mode: 'web',
    workspaceId: record.workspace.id,
    workspacePath: record.workspace.absolutePath,
    sessionId: record.sessionId,
    userMessage: { role: 'user', content: record.userMessage.content },
    modelContext: record.modelContext
  })
  let modelMessages: ChatMessage[] | undefined
  let currentTurnStartIndex = 0
  try {
    const runtime = await buildAgentRuntime(record.workspace.absolutePath, new Date(), {
      thinkingMode: record.thinkingMode,
      memoryCwd: record.memoryCwd,
      memoryQuery: record.userMessage.content,
      memoryTask: 'conversation'
    })
    emit(record, { type: 'continuity', snapshot: runtime.continuitySnapshot })
    await persistContinuitySnapshot(record.memoryCwd, runtime.continuitySnapshot).catch(() => {})
    modelMessages = [{ role: 'system', content: runtime.systemPrompt }, ...record.messages]
    const runTools = filterToolsForSession(runtime.tools, record.disabledTools)
    const persistedStartIndex = modelMessages.length
    currentTurnStartIndex = Math.max(1, modelMessages.length - 1)
    const result = await runAgentLoop({
      config: runtime.config,
      runId: record.id,
      tools: runTools,
      messages: modelMessages,
      observer: recorder.createObserver(createWebObserver((event) => {
        if (event.type !== 'final') {
          emit(record, event)
        }
      })),
      callModel: recorder.wrapCallModel(callModel ?? defaultCallModel),
      abortSignal: record.abortController.signal
    })
    if (record.cancelled) {
      await recorder.recordMessages(modelMessages.slice(currentTurnStartIndex))
      await recorder.finalize({ status: 'error', finalText: '', error: new Error('Run cancelled.') })
      return
    }
    const traceMessages = modelMessages.slice(currentTurnStartIndex)
    await appendRunModelMessages({
      cwd: record.cwd,
      sessionId: record.sessionId,
      messages: modelMessages.slice(persistedStartIndex),
      fallbackFinalText: result.finalText
    })
    await recorder.recordMessages(traceMessages)
    await recorder.finalize({ status: 'ok', finalText: result.finalText })
    emit(record, { type: 'final', text: result.finalText })
  } catch (error) {
    if (record.cancelled || isAbortError(error)) {
      record.cancelled = true
      await recorder.recordMessages(modelMessages?.slice(currentTurnStartIndex) ?? [record.userMessage])
      await recorder.finalize({ status: 'error', finalText: '', error: new Error('Run cancelled.') })
      return
    }
    await recorder.recordMessages(modelMessages?.slice(currentTurnStartIndex) ?? [record.userMessage])
    await recorder.finalize({ status: 'error', finalText: '', error })
    await appendSessionEvent({
      cwd: record.cwd,
      sessionId: record.sessionId,
      event: {
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      }
    }).catch(() => {})
    emit(record, errorEvent(error))
  }
}

async function appendRunModelMessages(input: {
  cwd: string
  sessionId: string
  messages: ChatMessage[]
  fallbackFinalText: string
}): Promise<void> {
  let persistedFinalText = false
  for (const message of input.messages) {
    if (message.role === 'system') {
      continue
    }
    if (message.role === 'assistant' && message.content === input.fallbackFinalText) {
      persistedFinalText = true
    }
    await appendSessionEvent({
      cwd: input.cwd,
      sessionId: input.sessionId,
      event: { type: 'message', message }
    })
  }

  if (!persistedFinalText && input.fallbackFinalText.trim() !== '') {
    await appendSessionEvent({
      cwd: input.cwd,
      sessionId: input.sessionId,
      event: { type: 'message', message: { role: 'assistant', content: input.fallbackFinalText } }
    })
  }
}

async function getWorkspaces(response: ServerResponse, context: WebServerContext): Promise<void> {
  try {
    writeJson(response, 200, { workspaces: await listWorkspaces(context.cwd) })
  } catch (error) {
    writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

async function getWorkspaceMarkdown(
  response: ServerResponse,
  context: WebServerContext,
  workspaceId: string
): Promise<void> {
  try {
    const workspace = await resolveWorkspace(context.cwd, workspaceId)
    writeJson(response, 200, { files: await listMarkdownFiles(workspace) })
  } catch (error) {
    writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

async function getWorkspaceMarkdownFile(
  response: ServerResponse,
  context: WebServerContext,
  workspaceId: string,
  fileId: string
): Promise<void> {
  try {
    const workspace = await resolveWorkspace(context.cwd, workspaceId)
    writeJson(response, 200, { file: await readMarkdownFile(workspace, fileId) })
  } catch (error) {
    writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

async function getWorkspaceAsset(
  response: ServerResponse,
  context: WebServerContext,
  workspaceId: string,
  assetPath: string
): Promise<void> {
  let workspace: WorkspaceInfo
  try {
    workspace = await resolveWorkspace(context.cwd, workspaceId)
  } catch (error) {
    writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
    return
  }

  try {
    const asset = await resolveWorkspaceAsset(workspace, assetPath)
    response.writeHead(200, { 'content-type': asset.contentType })
    createReadStream(asset.path).pipe(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeJson(response, message.startsWith('Workspace asset does not exist:') ? 404 : 400, { error: message })
  }
}

async function getSessions(response: ServerResponse, context: WebServerContext): Promise<void> {
  writeJson(response, 200, { sessions: await listSessions(context.cwd) })
}

async function getSession(response: ServerResponse, context: WebServerContext, sessionId: string): Promise<void> {
  let loaded: Awaited<ReturnType<typeof loadSession>>
  try {
    loaded = await loadSession({
      cwd: context.cwd,
      sessionId,
      recentMessages: context.runtime.config.sessionResumeRecentMessages
    })
  } catch (error) {
    if (isUnsafeSessionError(error)) {
      writeJson(response, 400, { error: 'Invalid session id.' })
      return
    }
    throw error
  }
  if (loaded === null) {
    writeJson(response, 404, { error: 'Session not found.' })
    return
  }

  writeJson(response, 200, {
    session: loaded.session,
    messages: loaded.messages
  })
}

async function patchSession(
  request: IncomingMessage,
  response: ServerResponse,
  context: WebServerContext,
  sessionId: string
): Promise<void> {
  let body: unknown
  try {
    body = JSON.parse(await readRequestBody(request))
  } catch (error) {
    writeJson(
      response,
      error instanceof RequestBodyTooLargeError ? 413 : 400,
      { error: error instanceof RequestBodyTooLargeError ? 'Request body too large.' : 'Invalid JSON body.' }
    )
    return
  }

  if (!isObject(body) || typeof body.pinned !== 'boolean') {
    writeJson(response, 400, { error: 'pinned must be a boolean.' })
    return
  }

  let session: SessionIndexItem | null
  try {
    session = await updateSessionPinned({
      cwd: context.cwd,
      sessionId,
      pinned: body.pinned
    })
  } catch (error) {
    if (isUnsafeSessionError(error)) {
      writeJson(response, 400, { error: 'Invalid session id.' })
      return
    }
    throw error
  }

  if (session === null) {
    writeJson(response, 404, { error: 'Session not found.' })
    return
  }

  writeJson(response, 200, { session })
}

async function deleteSessionRoute(
  response: ServerResponse,
  context: WebServerContext,
  sessionId: string
): Promise<void> {
  let deleted: boolean
  try {
    deleted = await deleteSession({
      cwd: context.cwd,
      sessionId
    })
  } catch (error) {
    if (isUnsafeSessionError(error)) {
      writeJson(response, 400, { error: 'Invalid session id.' })
      return
    }
    if (isUnsafeSessionStorageError(error)) {
      writeJson(response, 409, { error: 'Session storage is invalid.' })
      return
    }
    throw error
  }

  if (!deleted) {
    writeJson(response, 404, { error: 'Session not found.' })
    return
  }

  writeJson(response, 200, { deleted: true })
}

async function cancelRun(
  response: ServerResponse,
  runs: Map<string, RunRecord>,
  runId: string
): Promise<void> {
  const record = runs.get(runId)
  if (record === undefined) {
    writeJson(response, 404, { error: 'Run not found.' })
    return
  }

  if (record.done) {
    writeJson(response, 200, { cancelled: record.cancelled, done: true })
    return
  }

  record.cancelled = true
  record.abortController.abort()
  await rollbackCancelledSession(record).catch(() => {})
  emit(record, { type: 'cancelled', message: 'Run cancelled.' })
  writeJson(response, 202, { cancelled: true })
}

async function rollbackCancelledSession(record: RunRecord): Promise<void> {
  if (record.createdSession) {
    await deleteSession({ cwd: record.cwd, sessionId: record.sessionId })
    return
  }

  await removeLastSessionMessage({
    cwd: record.cwd,
    sessionId: record.sessionId,
    expectedMessage: record.userMessage
  })
}

function emit(record: RunRecord, event: WebRunEvent): void {
  if (record.done) {
    return
  }

  record.events.push(event)

  for (const client of record.clients) {
    writeSseEvent(client, event)
  }

  if (event.type === 'final' || event.type === 'error' || event.type === 'cancelled') {
    record.done = true
    for (const client of record.clients) {
      client.end()
    }
    record.clients.clear()
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))
}

function streamRunEvents(
  request: IncomingMessage,
  response: ServerResponse,
  runs: Map<string, RunRecord>,
  runId: string
): void {
  const record = runs.get(runId)
  if (record === undefined) {
    writeJson(response, 404, { error: 'Run not found.' })
    return
  }

  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  })

  for (const event of record.events) {
    writeSseEvent(response, event)
  }

  if (record.done) {
    response.end()
    return
  }

  record.clients.add(response)
  request.on('close', () => {
    record.clients.delete(response)
  })
}

function writeSseEvent(response: ServerResponse, event: WebRunEvent): void {
  response.write('event: message\n')
  response.write(`data: ${JSON.stringify(event)}\n\n`)
}

function parseRunRequest(body: unknown): {
  ok: true
  message: ChatMessage
  sessionId?: string
  workspaceId?: string
  thinkingMode?: ThinkingMode
  disabledTools?: string[]
} | { ok: false; error: string } {
  if (!isObject(body)) {
    return { ok: false, error: 'At least one user message is required.' }
  }

  const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim().length > 0 ? body.sessionId : undefined
  if (Object.prototype.hasOwnProperty.call(body, 'workspaceId') && typeof body.workspaceId !== 'string') {
    return { ok: false, error: 'workspaceId must be a string.' }
  }
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined
  const thinkingModeResult = parseThinkingModeOverride(body.thinkingMode)
  if (!thinkingModeResult.ok) {
    return thinkingModeResult
  }
  const thinkingMode = thinkingModeResult.thinkingMode
  const disabledToolsResult = parseDisabledTools(body.disabledTools)
  if (!disabledToolsResult.ok) {
    return disabledToolsResult
  }
  const disabledTools = disabledToolsResult.disabledTools

  if (Object.prototype.hasOwnProperty.call(body, 'messages')) {
    if (!Array.isArray(body.messages)) {
      return { ok: false, error: 'At least one user message is required.' }
    }

    if (body.messages.length === 0) {
      return { ok: false, error: 'At least one user message is required.' }
    }

    if (body.messages.length !== 1) {
      const unsupported = body.messages.find((message) => isObject(message) && typeof message.role === 'string' && message.role !== 'user')
      if (unsupported !== undefined && isObject(unsupported)) {
        return { ok: false, error: `Unsupported message role: ${unsupported.role}.` }
      }
      return { ok: false, error: 'Exactly one user message is supported.' }
    }

    const [message] = body.messages
    if (!isObject(message) || typeof message.role !== 'string' || typeof message.content !== 'string') {
      return { ok: false, error: 'Invalid message.' }
    }

    const role = message.role as ChatRole
    if (role !== 'user') {
      return { ok: false, error: `Unsupported message role: ${message.role}.` }
    }

    if (typeof body.message === 'string') {
      return { ok: true, message: { role: 'user', content: body.message }, sessionId, workspaceId, thinkingMode, disabledTools }
    }

    return { ok: true, message: { role, content: message.content }, sessionId, workspaceId, thinkingMode, disabledTools }
  }

  if (typeof body.message === 'string') {
    return { ok: true, message: { role: 'user', content: body.message }, sessionId, workspaceId, thinkingMode, disabledTools }
  }

  return { ok: false, error: 'At least one user message is required.' }
}

function parseDisabledTools(value: unknown): (
  | { ok: true; disabledTools?: string[] }
  | { ok: false; error: string }
) {
  if (value === undefined) {
    return { ok: true }
  }
  if (!Array.isArray(value) || !value.every((tool) => typeof tool === 'string')) {
    return { ok: false, error: 'disabledTools must be an array of tool names.' }
  }
  return { ok: true, disabledTools: Array.from(new Set(value.map((tool) => tool.trim()).filter(Boolean))).sort() }
}

function validateDisabledTools(disabledTools: string[] | undefined, availableToolNames: string[]): string | undefined {
  if (disabledTools === undefined) {
    return undefined
  }
  const available = new Set(availableToolNames)
  const unavailable = disabledTools.find((tool) => !available.has(tool))
  return unavailable === undefined
    ? undefined
    : `Tool is disabled by config and cannot be enabled for this session. Unavailable tool: ${unavailable}`
}

function parseThinkingModeOverride(value: unknown): { ok: true; thinkingMode?: ThinkingMode } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true }
  }
  if (value === 'auto' || value === 'on' || value === 'off') {
    return { ok: true, thinkingMode: value }
  }
  return { ok: false, error: 'thinkingMode must be auto, on, or off.' }
}

function decodeRouteWorkspaceId(response: ServerResponse, value: string): string | undefined {
  try {
    return decodeWorkspaceId(value)
  } catch {
    writeJson(response, 400, { error: `Invalid workspace id: ${value}` })
    return undefined
  }
}

function decodeRouteComponent(response: ServerResponse, value: string, label: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    writeJson(response, 400, { error: `Invalid ${label}: ${value}` })
    return undefined
  }
}

function decodeSessionId(response: ServerResponse, value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    writeJson(response, 400, { error: 'Invalid session id.' })
    return undefined
  }
}

function decodeWorkspaceId(value: string): string {
  return value === '@root' ? '' : decodeURIComponent(value)
}

function isSessionWorkspaceCompatible(session: SessionIndexItem, workspaceId: string): boolean {
  return session.workspaceId === undefined ? workspaceId === '' : session.workspaceId === workspaceId
}

async function serveStaticFile(response: ServerResponse, relativePath: string): Promise<void> {
  const normalizedPath = normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '')
  const filePath = resolve(staticDir, normalizedPath)
  if (filePath !== staticDir && !filePath.startsWith(`${staticDir}${sep}`)) {
    writeJson(response, 404, { error: 'Not found.' })
    return
  }

  try {
    await readFile(filePath)
  } catch {
    writeJson(response, 404, { error: 'Not found.' })
    return
  }

  response.writeHead(200, { 'content-type': contentTypeFor(filePath) })
  createReadStream(filePath).pipe(response)
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return 'application/octet-stream'
  }
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let settled = false
    request.on('data', (chunk: Buffer) => {
      if (settled) {
        return
      }
      totalBytes += chunk.byteLength
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        settled = true
        rejectBody(new RequestBodyTooLargeError())
        request.resume()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) {
        return
      }
      settled = true
      resolveBody(Buffer.concat(chunks).toString('utf8'))
    })
    request.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      rejectBody(error)
    })
  })
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isUnsafeSessionError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Unsafe session id:')
}

function isUnsafeSessionStorageError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Session path must not be a symlink:')
}
