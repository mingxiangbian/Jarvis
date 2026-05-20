import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendSessionEvent,
  createSession,
  listSessions,
  loadSession
} from '../src/session-store.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('session store', () => {
  it('creates, lists, appends, and loads recent model messages', async () => {
    const cwd = await createTempCwd()
    const session = await createSession({
      cwd,
      mode: 'web',
      model: 'test-model',
      id: 'session-1',
      now: new Date('2026-05-20T01:00:00.000Z'),
      firstUserMessage: { role: 'user', content: 'Explain session history support' }
    })

    await appendSessionEvent({
      cwd,
      sessionId: session.id,
      event: {
        type: 'message',
        at: '2026-05-20T01:01:00.000Z',
        message: { role: 'assistant', content: 'History is persisted.' }
      }
    })
    await appendSessionEvent({
      cwd,
      sessionId: session.id,
      event: {
        type: 'message',
        at: '2026-05-20T01:02:00.000Z',
        message: { role: 'user', content: 'Resume with only the latest turn.' }
      }
    })

    await expect(listSessions(cwd)).resolves.toEqual([
      expect.objectContaining({
        id: 'session-1',
        mode: 'web',
        title: 'Explain session history support',
        preview: 'Resume with only the latest turn.',
        model: 'test-model',
        createdAt: '2026-05-20T01:00:00.000Z',
        updatedAt: '2026-05-20T01:02:00.000Z'
      })
    ])

    await expect(loadSession({ cwd, sessionId: session.id, recentMessages: 2 })).resolves.toEqual({
      session: expect.objectContaining({ id: 'session-1' }),
      messages: [
        { role: 'user', content: 'Explain session history support' },
        { role: 'assistant', content: 'History is persisted.' },
        { role: 'user', content: 'Resume with only the latest turn.' }
      ],
      modelMessages: [
        { role: 'assistant', content: 'History is persisted.' },
        { role: 'user', content: 'Resume with only the latest turn.' }
      ]
    })

    await expect(readFile(join(cwd, '.cc-local', 'sessions', 'session-1.jsonl'), 'utf8')).resolves.toContain(
      '"content":"History is persisted."'
    )
  })

  it('keeps unsafe session ids out of the session directory', async () => {
    const cwd = await createTempCwd()

    await expect(createSession({
      cwd,
      mode: 'repl',
      model: 'test-model',
      id: '../outside'
    })).rejects.toThrow('Unsafe session id')
    await expect(loadSession({ cwd, sessionId: '../outside', recentMessages: 10 })).rejects.toThrow(
      'Unsafe session id'
    )
  })

  it('rejects session directories that resolve outside the project', async () => {
    const cwd = await createTempCwd()
    const outside = await createTempCwd()
    await mkdir(join(cwd, '.cc-local'), { recursive: true })
    await symlink(outside, join(cwd, '.cc-local', 'sessions'))

    await expect(listSessions(cwd)).rejects.toThrow('Session directory must stay inside the project.')
  })

  it('returns null for missing sessions', async () => {
    const cwd = await createTempCwd()

    await expect(loadSession({ cwd, sessionId: 'missing', recentMessages: 10 })).resolves.toBeNull()
  })
})

async function createTempCwd(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'cc-local-session-store-'))
  tempDirs.push(cwd)
  return cwd
}
