import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendSessionEvent,
  createSession,
  deleteSession,
  listSessions,
  loadSession,
  updateSessionPinned
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

    await expect(readFile(join(cwd, '.jarvis', 'sessions', 'session-1.jsonl'), 'utf8')).resolves.toContain(
      '"content":"History is persisted."'
    )
  })

  it('loads generate_image tool results as model history without replaying raw tool protocol', async () => {
    const cwd = await createTempCwd()
    const session = await createSession({
      cwd,
      mode: 'web',
      model: 'test-model',
      id: 'tool-session',
      now: new Date('2026-05-20T01:00:00.000Z'),
      firstUserMessage: { role: 'user', content: 'Generate an image' }
    })

    await appendSessionEvent({
      cwd,
      sessionId: session.id,
      event: {
        type: 'message',
        at: '2026-05-20T01:01:00.000Z',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call-image',
            type: 'function',
            function: {
              name: 'generate_image',
              arguments: '{"prompt":"portrait"}'
            }
          }]
        }
      }
    })
    await appendSessionEvent({
      cwd,
      sessionId: session.id,
      event: {
        type: 'message',
        at: '2026-05-20T01:02:00.000Z',
        message: {
          role: 'tool',
          content: 'Generated images: generated-images/image.png',
          tool_call_id: 'call-image'
        }
      }
    })
    await appendSessionEvent({
      cwd,
      sessionId: session.id,
      event: {
        type: 'message',
        at: '2026-05-20T01:03:00.000Z',
        message: { role: 'assistant', content: 'Image generated.' }
      }
    })

    await expect(listSessions(cwd)).resolves.toEqual([
      expect.objectContaining({
        id: 'tool-session',
        preview: 'Image generated.'
      })
    ])
    const loaded = await loadSession({ cwd, sessionId: session.id, recentMessages: 10 })
    expect(loaded).toEqual({
      session: expect.objectContaining({ id: 'tool-session' }),
      messages: [
        { role: 'user', content: 'Generate an image' },
        { role: 'assistant', content: 'Image generated.' }
      ],
      modelMessages: [
        { role: 'user', content: 'Generate an image' },
        {
          role: 'assistant',
          content: expect.stringContaining('generated-images/image.png')
        },
        { role: 'assistant', content: 'Image generated.' }
      ]
    })
    expect(JSON.stringify(loaded?.modelMessages)).not.toContain('"role":"tool"')
    expect(JSON.stringify(loaded?.modelMessages)).not.toContain('"tool_calls"')
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

  it('persists optional workspace ids in the session index', async () => {
    const cwd = await createTempCwd()

    await createSession({
      cwd,
      mode: 'web',
      model: 'test-model',
      id: 'project-session',
      workspaceId: 'project-a',
      firstUserMessage: { role: 'user', content: 'Remember project A context' }
    })

    await expect(listSessions(cwd)).resolves.toEqual([
      expect.objectContaining({
        id: 'project-session',
        workspaceId: 'project-a'
      })
    ])
    await expect(readFile(join(cwd, '.jarvis', 'sessions', 'index.json'), 'utf8')).resolves.toContain(
      '"workspaceId": "project-a"'
    )
  })

  it('rejects session directories that resolve outside the project', async () => {
    const cwd = await createTempCwd()
    const outside = await createTempCwd()
    await mkdir(join(cwd, '.jarvis'), { recursive: true })
    await symlink(outside, join(cwd, '.jarvis', 'sessions'))

    await expect(listSessions(cwd)).rejects.toThrow('Session directory must stay inside the project.')
  })

  it('returns null for missing sessions', async () => {
    const cwd = await createTempCwd()

    await expect(loadSession({ cwd, sessionId: 'missing', recentMessages: 10 })).resolves.toBeNull()
  })

  it('sorts pinned sessions first while keeping updated order within groups', async () => {
    const cwd = await createTempCwd()
    await createSession({
      cwd,
      mode: 'web',
      model: 'test-model',
      id: 'older-pinned',
      now: new Date('2026-05-20T01:00:00.000Z')
    })
    await createSession({
      cwd,
      mode: 'web',
      model: 'test-model',
      id: 'newer-unpinned',
      now: new Date('2026-05-20T03:00:00.000Z')
    })
    await createSession({
      cwd,
      mode: 'web',
      model: 'test-model',
      id: 'newer-pinned',
      now: new Date('2026-05-20T02:00:00.000Z')
    })

    await updateSessionPinned({ cwd, sessionId: 'older-pinned', pinned: true })
    await updateSessionPinned({ cwd, sessionId: 'newer-pinned', pinned: true })

    await expect(listSessions(cwd)).resolves.toMatchObject([
      { id: 'newer-pinned', pinned: true },
      { id: 'older-pinned', pinned: true },
      { id: 'newer-unpinned', pinned: false }
    ])
  })

  it('updates pinned state and persists it through the session index', async () => {
    const cwd = await createTempCwd()
    await createSession({
      cwd,
      mode: 'web',
      model: 'test-model',
      id: 'pin-me'
    })

    await expect(updateSessionPinned({ cwd, sessionId: 'pin-me', pinned: true })).resolves.toEqual(
      expect.objectContaining({ id: 'pin-me', pinned: true })
    )
    await expect(listSessions(cwd)).resolves.toEqual([
      expect.objectContaining({ id: 'pin-me', pinned: true })
    ])
    await expect(updateSessionPinned({ cwd, sessionId: 'pin-me', pinned: false })).resolves.toEqual(
      expect.objectContaining({ id: 'pin-me', pinned: false })
    )
    await expect(updateSessionPinned({ cwd, sessionId: 'missing', pinned: true })).resolves.toBeNull()
  })

  it('treats legacy index entries without pinned as unpinned', async () => {
    const cwd = await createTempCwd()
    await mkdir(join(cwd, '.jarvis', 'sessions'), { recursive: true })
    await writeFile(join(cwd, '.jarvis', 'sessions', 'index.json'), JSON.stringify([
      {
        id: 'legacy',
        mode: 'web',
        title: 'Legacy',
        preview: '',
        createdAt: '2026-05-20T01:00:00.000Z',
        updatedAt: '2026-05-20T01:00:00.000Z',
        model: 'test-model'
      }
    ]), 'utf8')

    await expect(listSessions(cwd)).resolves.toEqual([
      expect.objectContaining({ id: 'legacy', pinned: false })
    ])
  })

  it('deletes sessions from the index and removes their JSONL file', async () => {
    const cwd = await createTempCwd()
    await createSession({
      cwd,
      mode: 'web',
      model: 'test-model',
      id: 'delete-me'
    })

    await expect(deleteSession({ cwd, sessionId: 'delete-me' })).resolves.toBe(true)
    await expect(listSessions(cwd)).resolves.toEqual([])
    await expect(readFile(join(cwd, '.jarvis', 'sessions', 'delete-me.jsonl'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(deleteSession({ cwd, sessionId: 'delete-me' })).resolves.toBe(false)
  })

  it('deletes index entries even when the JSONL file is already missing', async () => {
    const cwd = await createTempCwd()
    await createSession({
      cwd,
      mode: 'web',
      model: 'test-model',
      id: 'missing-jsonl'
    })
    await rm(join(cwd, '.jarvis', 'sessions', 'missing-jsonl.jsonl'))

    await expect(deleteSession({ cwd, sessionId: 'missing-jsonl' })).resolves.toBe(true)
    await expect(listSessions(cwd)).resolves.toEqual([])
  })

  it('rejects deleting a symlink JSONL file and leaves the target and index entry intact', async () => {
    const cwd = await createTempCwd()
    const outside = await createTempCwd()
    await createSession({
      cwd,
      mode: 'web',
      model: 'test-model',
      id: 'symlink-session'
    })
    const sessionPath = join(cwd, '.jarvis', 'sessions', 'symlink-session.jsonl')
    const outsideTarget = join(outside, 'outside-session.jsonl')
    await rm(sessionPath)
    await writeFile(outsideTarget, 'outside\n', 'utf8')
    await symlink(outsideTarget, sessionPath)

    await expect(deleteSession({ cwd, sessionId: 'symlink-session' })).rejects.toThrow(
      'Session path must not be a symlink'
    )
    await expect(readFile(outsideTarget, 'utf8')).resolves.toBe('outside\n')
    await expect(listSessions(cwd)).resolves.toEqual([
      expect.objectContaining({ id: 'symlink-session' })
    ])
  })
})

async function createTempCwd(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'jarvis-session-store-'))
  tempDirs.push(cwd)
  return cwd
}
