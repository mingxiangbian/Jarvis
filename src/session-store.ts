import { appendFile, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChatMessage } from './llm-client.js'

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
    pinned: false
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
    if (existing.title === 'Untitled session' && input.event.message.role === 'user') {
      next.title = titleFromMessage(input.event.message) ?? existing.title
    }
    next.preview = previewFromMessage(input.event.message) ?? existing.preview
  } else {
    next.preview = truncateOneLine(input.event.message, 120)
  }

  await writeIndex(input.cwd, upsertSession(index, next))
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
      if (event.message.role === 'user' || event.message.role === 'assistant') {
        messages.push({ role: event.message.role, content: event.message.content })
        modelMessages.push({ role: event.message.role, content: event.message.content })
      }
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
      if ((role === 'user' || role === 'assistant') && typeof content === 'string') {
        return {
          type: 'message',
          at: typeof parsed.at === 'string' ? parsed.at : undefined,
          message: { role, content }
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
  return {
    ...item,
    pinned: item.pinned ?? false
  }
}

function sessionsDir(cwd: string): string {
  return resolve(cwd, '.cc-local', 'sessions')
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
    (value.pinned === undefined || typeof value.pinned === 'boolean')
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
