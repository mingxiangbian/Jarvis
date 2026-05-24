import { appendFile, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChatMessage } from './llm-client.js'
import type { NormalizedUsage, ProviderMetadata, ThinkingMode } from './models/types.js'

export type SessionMode = 'web' | 'repl'

export interface SessionIndexItem {
  id: string
  mode: SessionMode
  workspaceId?: string
  title: string
  preview: string
  createdAt: string
  updatedAt: string
  model: string
  pinned: boolean
  disabledTools?: string[]
}

export type SessionEvent =
  | {
      type: 'message'
      at?: string
      message: ChatMessage
    }
  | {
      type: 'error'
      at?: string
      message: string
    }

export interface SessionDisplayMessage {
  role: 'user' | 'assistant' | 'error'
  content: string
}

export interface LoadedSession {
  session: SessionIndexItem
  messages: SessionDisplayMessage[]
  modelMessages: ChatMessage[]
}

export async function createSession(input: {
  cwd: string
  mode: SessionMode
  model: string
  firstUserMessage?: ChatMessage
  now?: Date
  id?: string
  workspaceId?: string
  disabledTools?: string[]
}): Promise<SessionIndexItem> {
  const id = input.id ?? randomUUID()
  assertSafeSessionId(id)
  const now = toIso(input.now)
  const session: SessionIndexItem = {
    id,
    mode: input.mode,
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    title: titleFromMessage(input.firstUserMessage) ?? 'Untitled session',
    preview: previewFromMessage(input.firstUserMessage) ?? '',
    createdAt: now,
    updatedAt: now,
    model: input.model,
    pinned: false,
    ...(input.disabledTools === undefined || input.disabledTools.length === 0
      ? {}
      : { disabledTools: normalizeDisabledTools(input.disabledTools) })
  }

  const existing = await readIndex(input.cwd)
  await writeIndex(input.cwd, upsertSession(existing, session))

  if (input.firstUserMessage !== undefined) {
    await appendEventLine(input.cwd, id, {
      type: 'message',
      at: now,
      message: input.firstUserMessage
    })
  } else {
    await ensureSessionsDir(input.cwd)
    const path = sessionFilePath(input.cwd, id)
    await writeFile(path, '', { flag: 'wx' }).catch(async (error: unknown) => {
      if (isFileExistsError(error)) {
        await assertPathIsNotSymlink(path)
        return
      }
      throw error
    })
  }

  return session
}

export async function appendSessionEvent(input: {
  cwd: string
  sessionId: string
  event: SessionEvent
}): Promise<void> {
  assertSafeSessionId(input.sessionId)
  const index = await readIndex(input.cwd)
  const existing = index.find((item) => item.id === input.sessionId)
  if (existing === undefined) {
    throw new Error(`Session not found: ${input.sessionId}`)
  }

  const at = input.event.at ?? new Date().toISOString()
  const event = { ...input.event, at }
  await appendEventLine(input.cwd, input.sessionId, event)

  const next: SessionIndexItem = {
    ...existing,
    updatedAt: at
  }
  if (input.event.type === 'message') {
    if (existing.title === 'Untitled session' && isDisplayMessage(input.event.message) && input.event.message.role === 'user') {
      next.title = titleFromMessage(input.event.message) ?? existing.title
    }
    if (isDisplayMessage(input.event.message)) {
      next.preview = previewFromMessage(input.event.message) ?? existing.preview
    }
  } else {
    next.preview = truncateOneLine(input.event.message, 120)
  }

  await writeIndex(input.cwd, upsertSession(index, next))
}

export async function removeLastSessionMessage(input: {
  cwd: string
  sessionId: string
  expectedMessage: ChatMessage
}): Promise<boolean> {
  assertSafeSessionId(input.sessionId)
  const index = await readIndex(input.cwd)
  const existing = index.find((item) => item.id === input.sessionId)
  if (existing === undefined) {
    return false
  }

  const path = sessionFilePath(input.cwd, input.sessionId)
  await assertPathIsNotSymlink(path)
  const raw = await readFile(path, 'utf8').catch((error: unknown) => {
    if (isObject(error) && error.code === 'ENOENT') return ''
    throw error
  })
  const lines = raw.split(/\r?\n/)
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') {
    lines.pop()
  }
  const lastIndex = lines.length - 1
  if (lastIndex < 0) {
    return false
  }

  const event = parseEventLine(lines[lastIndex] ?? '')
  if (
    event?.type !== 'message' ||
    event.message.role !== input.expectedMessage.role ||
    event.message.content !== input.expectedMessage.content
  ) {
    return false
  }

  lines.splice(lastIndex, 1)
  await writeFile(path, lines.length === 0 ? '' : `${lines.join('\n')}\n`, 'utf8')

  const remainingEvents = lines
    .map(parseEventLine)
    .filter((entry): entry is SessionEvent => entry !== null)
  const displayEvents = remainingEvents.filter((entry) => entry.type === 'message' && isDisplayMessage(entry.message))
  const firstUser = displayEvents.find((entry) => entry.type === 'message' && entry.message.role === 'user')
  const lastDisplay = [...remainingEvents].reverse().find((entry) => {
    return entry.type === 'error' || (entry.type === 'message' && isDisplayMessage(entry.message))
  })
  const next: SessionIndexItem = {
    ...existing,
    title: firstUser?.type === 'message' ? titleFromMessage(firstUser.message) ?? 'Untitled session' : 'Untitled session',
    preview: previewFromSessionEvent(lastDisplay),
    updatedAt: lastDisplay?.at ?? existing.createdAt
  }
  await writeIndex(input.cwd, upsertSession(index, next))
  return true
}

export async function listSessions(cwd: string): Promise<SessionIndexItem[]> {
  return readIndex(cwd)
}

export async function updateSessionPinned(input: {
  cwd: string
  sessionId: string
  pinned: boolean
}): Promise<SessionIndexItem | null> {
  assertSafeSessionId(input.sessionId)
  const index = await readIndex(input.cwd)
  const existing = index.find((item) => item.id === input.sessionId)
  if (existing === undefined) {
    return null
  }

  const updated: SessionIndexItem = {
    ...existing,
    pinned: input.pinned
  }
  await writeIndex(input.cwd, upsertSession(index, updated))
  return updated
}

export async function updateSessionDisabledTools(input: {
  cwd: string
  sessionId: string
  disabledTools: string[]
}): Promise<SessionIndexItem | null> {
  assertSafeSessionId(input.sessionId)
  const index = await readIndex(input.cwd)
  const existing = index.find((item) => item.id === input.sessionId)
  if (existing === undefined) {
    return null
  }

  const disabledTools = normalizeDisabledTools(input.disabledTools)
  const updated: SessionIndexItem = {
    ...existing,
    ...(disabledTools.length === 0 ? { disabledTools: undefined } : { disabledTools })
  }
  await writeIndex(input.cwd, upsertSession(index, updated))
  return updated
}

export async function deleteSession(input: {
  cwd: string
  sessionId: string
}): Promise<boolean> {
  assertSafeSessionId(input.sessionId)
  const index = await readIndex(input.cwd)
  if (!index.some((item) => item.id === input.sessionId)) {
    return false
  }

  try {
    const path = sessionFilePath(input.cwd, input.sessionId)
    await assertPathIsNotSymlink(path)
    await rm(path)
  } catch (error) {
    if (!isObject(error) || error.code !== 'ENOENT') {
      throw error
    }
  }

  await writeIndex(input.cwd, index.filter((item) => item.id !== input.sessionId))
  return true
}

export async function loadSession(input: {
  cwd: string
  sessionId: string
  recentMessages: number
}): Promise<LoadedSession | null> {
  assertSafeSessionId(input.sessionId)
  const index = await readIndex(input.cwd)
  const session = index.find((item) => item.id === input.sessionId)
  if (session === undefined) {
    return null
  }

  let raw = ''
  try {
    await assertPathIsNotSymlink(sessionFilePath(input.cwd, input.sessionId))
    raw = await readFile(sessionFilePath(input.cwd, input.sessionId), 'utf8')
  } catch (error) {
    if (!isObject(error) || error.code !== 'ENOENT') {
      throw error
    }
    return { session, messages: [], modelMessages: [] }
  }

  const events = raw
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map(parseEventLine)
    .filter((event): event is SessionEvent => event !== null)

  const messages: SessionDisplayMessage[] = []
  const modelMessages: ChatMessage[] = []
  for (const event of events) {
    if (event.type === 'message') {
      if (isDisplayMessage(event.message)) {
        messages.push({ role: event.message.role, content: event.message.content })
      }
      modelMessages.push(copyModelMessage(event.message))
      continue
    }
    messages.push({ role: 'error', content: event.message })
  }

  const recent = Math.max(0, input.recentMessages)
  return {
    session,
    messages,
    modelMessages: recent === 0 ? [] : modelMessages.slice(-recent)
  }
}

function parseEventLine(line: string): SessionEvent | null {
  try {
    const parsed = JSON.parse(line) as unknown
    if (!isObject(parsed) || typeof parsed.type !== 'string') {
      return null
    }
    if (parsed.type === 'message' && isObject(parsed.message)) {
      const role = parsed.message.role
      const content = parsed.message.content
      if (
        (role === 'user' || role === 'assistant' || role === 'tool') &&
        typeof content === 'string' &&
        isValidToolCallMetadata(parsed.message) &&
        isValidProviderMetadata(parsed.message.providerMetadata)
      ) {
        return {
          type: 'message',
          at: typeof parsed.at === 'string' ? parsed.at : undefined,
          message: copyModelMessage(parsed.message as unknown as ChatMessage)
        }
      }
    }
    if (parsed.type === 'error' && typeof parsed.message === 'string') {
      return {
        type: 'error',
        at: typeof parsed.at === 'string' ? parsed.at : undefined,
        message: parsed.message
      }
    }
  } catch {
  }
  return null
}

function isValidToolCallMetadata(message: Record<string, unknown>): boolean {
  if (message.tool_call_id !== undefined && typeof message.tool_call_id !== 'string') {
    return false
  }

  return message.tool_calls === undefined || Array.isArray(message.tool_calls)
}

function isDisplayMessage(message: ChatMessage): message is ChatMessage & { role: 'user' | 'assistant' } {
  return (message.role === 'user' || message.role === 'assistant') && message.content.trim() !== ''
}

function copyModelMessage(message: ChatMessage): ChatMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.tool_call_id === undefined ? {} : { tool_call_id: message.tool_call_id }),
    ...(message.tool_calls === undefined
      ? {}
      : {
          tool_calls: message.tool_calls.map((toolCall) => ({
            id: toolCall.id,
            type: toolCall.type,
            function: { ...toolCall.function }
          }))
        }),
    ...(message.providerMetadata === undefined
      ? {}
      : { providerMetadata: copyProviderMetadata(message.providerMetadata) })
  }
}

function isValidProviderMetadata(metadata: unknown): metadata is ProviderMetadata | undefined {
  if (metadata === undefined) {
    return true
  }
  if (!isObject(metadata)) {
    return false
  }
  if (metadata.provider !== 'deepseek' && metadata.provider !== 'openai-compatible') {
    return false
  }
  if (typeof metadata.model !== 'string') {
    return false
  }
  if (metadata.thinking !== undefined && !isValidThinkingMetadata(metadata.thinking)) {
    return false
  }
  return metadata.usage === undefined || isValidUsageMetadata(metadata.usage)
}

function isValidThinkingMetadata(thinking: unknown): thinking is ProviderMetadata['thinking'] {
  if (!isObject(thinking)) {
    return false
  }
  return typeof thinking.enabled === 'boolean' &&
    isThinkingMode(thinking.mode) &&
    (thinking.reasoningContent === undefined || typeof thinking.reasoningContent === 'string')
}

function isThinkingMode(value: unknown): value is ThinkingMode {
  return value === 'auto' || value === 'on' || value === 'off'
}

function isValidUsageMetadata(usage: unknown): usage is NormalizedUsage {
  if (!isObject(usage)) {
    return false
  }
  return isOptionalNumber(usage.promptTokens) &&
    isOptionalNumber(usage.completionTokens) &&
    isOptionalNumber(usage.reasoningTokens) &&
    isOptionalNumber(usage.cacheHitTokens) &&
    isOptionalNumber(usage.cacheMissTokens)
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function copyProviderMetadata(metadata: ProviderMetadata): ProviderMetadata {
  return {
    provider: metadata.provider,
    model: metadata.model,
    ...(metadata.thinking === undefined
      ? {}
      : {
          thinking: {
            enabled: metadata.thinking.enabled,
            mode: metadata.thinking.mode,
            ...(metadata.thinking.reasoningContent === undefined
              ? {}
              : { reasoningContent: metadata.thinking.reasoningContent })
          }
        }),
    ...(metadata.usage === undefined
      ? {}
      : {
          usage: {
            ...(metadata.usage.promptTokens === undefined ? {} : { promptTokens: metadata.usage.promptTokens }),
            ...(metadata.usage.completionTokens === undefined
              ? {}
              : { completionTokens: metadata.usage.completionTokens }),
            ...(metadata.usage.reasoningTokens === undefined
              ? {}
              : { reasoningTokens: metadata.usage.reasoningTokens }),
            ...(metadata.usage.cacheHitTokens === undefined ? {} : { cacheHitTokens: metadata.usage.cacheHitTokens }),
            ...(metadata.usage.cacheMissTokens === undefined
              ? {}
              : { cacheMissTokens: metadata.usage.cacheMissTokens })
          }
        })
  }
}

async function appendEventLine(cwd: string, sessionId: string, event: SessionEvent): Promise<void> {
  await ensureSessionsDir(cwd)
  const path = sessionFilePath(cwd, sessionId)
  await assertPathIsNotSymlink(path)
  await appendFile(path, `${JSON.stringify(event)}\n`, 'utf8')
}

async function readIndex(cwd: string): Promise<SessionIndexItem[]> {
  let content: string
  try {
    await ensureSessionsDir(cwd)
    await assertPathIsNotSymlink(indexPath(cwd))
    content = await readFile(indexPath(cwd), 'utf8')
  } catch (error) {
    if (isObject(error) && error.code === 'ENOENT') {
      return []
    }
    throw error
  }

  try {
    const parsed = JSON.parse(content) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .filter(isSessionIndexItem)
      .map(normalizeSessionIndexItem)
      .sort(compareSessions)
  } catch {
    return []
  }
}

async function writeIndex(cwd: string, sessions: SessionIndexItem[]): Promise<void> {
  await ensureSessionsDir(cwd)
  const path = indexPath(cwd)
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(sessions.sort(compareSessions), null, 2)}\n`, 'utf8')
  await rename(tempPath, path)
}

async function ensureSessionsDir(cwd: string): Promise<void> {
  const dir = sessionsDir(cwd)
  await mkdir(dir, { recursive: true })
  const [cwdRealPath, dirRealPath, dirStat] = await Promise.all([
    realpath(cwd),
    realpath(dir),
    lstat(dir)
  ])
  if (dirStat.isSymbolicLink() || (dirRealPath !== cwdRealPath && !dirRealPath.startsWith(`${cwdRealPath}${sep}`))) {
    throw new Error('Session directory must stay inside the project.')
  }
}

function upsertSession(sessions: SessionIndexItem[], session: SessionIndexItem): SessionIndexItem[] {
  return [
    session,
    ...sessions.filter((item) => item.id !== session.id)
  ].sort(compareSessions)
}

function compareSessions(left: SessionIndexItem, right: SessionIndexItem): number {
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1
  }
  return right.updatedAt.localeCompare(left.updatedAt)
}

function normalizeSessionIndexItem(item: SessionIndexItem | LegacySessionIndexItem): SessionIndexItem {
  const disabledTools = Array.isArray(item.disabledTools)
    ? normalizeDisabledTools(item.disabledTools)
    : []
  return {
    ...item,
    pinned: item.pinned ?? false,
    ...(disabledTools.length === 0 ? {} : { disabledTools })
  }
}

function normalizeDisabledTools(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort()
}

function sessionsDir(cwd: string): string {
  return resolve(cwd, '.cyrene', 'sessions')
}

function indexPath(cwd: string): string {
  return join(sessionsDir(cwd), 'index.json')
}

function sessionFilePath(cwd: string, sessionId: string): string {
  assertSafeSessionId(sessionId)
  const dir = sessionsDir(cwd)
  const filePath = resolve(dir, `${sessionId}.jsonl`)
  if (filePath !== dir && !filePath.startsWith(`${dir}${sep}`)) {
    throw new Error(`Unsafe session id: ${sessionId}`)
  }
  return filePath
}

function assertSafeSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(sessionId)) {
    throw new Error(`Unsafe session id: ${sessionId}`)
  }
}

function titleFromMessage(message: ChatMessage | undefined): string | undefined {
  if (message === undefined || message.role !== 'user') {
    return undefined
  }
  return truncateOneLine(message.content, 48) || undefined
}

function previewFromMessage(message: ChatMessage | undefined): string | undefined {
  if (message === undefined) {
    return undefined
  }
  return truncateOneLine(message.content, 120)
}

function previewFromSessionEvent(event: SessionEvent | undefined): string {
  if (event === undefined) {
    return ''
  }
  if (event.type === 'error') {
    return truncateOneLine(event.message, 120)
  }
  return previewFromMessage(event.message) ?? ''
}

function truncateOneLine(text: string, maxLength: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= maxLength) {
    return oneLine
  }
  return `${oneLine.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function toIso(date: Date | undefined): string {
  return (date ?? new Date()).toISOString()
}

type LegacySessionIndexItem = Omit<SessionIndexItem, 'pinned'> & {
  pinned?: boolean
}

function isSessionIndexItem(value: unknown): value is LegacySessionIndexItem {
  return isObject(value) &&
    typeof value.id === 'string' &&
    (value.mode === 'web' || value.mode === 'repl') &&
    typeof value.title === 'string' &&
    typeof value.preview === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.model === 'string' &&
    (value.workspaceId === undefined || typeof value.workspaceId === 'string') &&
    (value.pinned === undefined || typeof value.pinned === 'boolean') &&
    (value.disabledTools === undefined ||
      (Array.isArray(value.disabledTools) && value.disabledTools.every((tool) => typeof tool === 'string')))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFileExistsError(error: unknown): boolean {
  return isObject(error) && error.code === 'EEXIST'
}

async function assertPathIsNotSymlink(path: string): Promise<void> {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) {
      throw new Error(`Session path must not be a symlink: ${path}`)
    }
  } catch (error) {
    if (isObject(error) && error.code === 'ENOENT') {
      return
    }
    throw error
  }
}
