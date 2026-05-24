import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

function cliEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const { FORCE_COLOR: _forceColor, NO_COLOR: _noColor, ...env } = process.env
  return { ...env, CYRENE_MEMORY_AUTO_EXTRACT: '0', ...overrides }
}

function expectOnlyTraceLine(stderr: string): void {
  expect(stderr).toMatch(/^trace: \.cyrene\/runs\/[A-Za-z0-9_.-]+\n$/)
}

function activeMemoryLine(input: { id: string; content: string; normalizedKey: string }): string {
  return `${JSON.stringify({
    id: input.id,
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: input.content,
    normalizedKey: input.normalizedKey,
    evidence: [{ runId: 'run-1', summary: 'Test evidence.' }],
    source: 'assistant_observed',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.8,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    tags: []
  })}\n`
}

describe('main CLI', () => {
  it('rejects --web with a prompt', async () => {
    try {
      await execFileAsync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--web', 'hello'], {
        env: cliEnv()
      })
      throw new Error('CLI unexpectedly succeeded')
    } catch (error) {
      expect((error as { code?: number }).code).toBe(1)
      expect(String((error as { stderr?: string }).stderr ?? '')).toContain('--web cannot be combined with a prompt.')
    }
  })

  it('rejects --web with --repl', async () => {
    try {
      await execFileAsync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--web', '--repl'], {
        env: cliEnv()
      })
      throw new Error('CLI unexpectedly succeeded')
    } catch (error) {
      expect((error as { code?: number }).code).toBe(1)
      expect(String((error as { stderr?: string }).stderr ?? '')).toContain('--web cannot be combined with --repl.')
    }
  })

  it('rejects --resume without --repl', async () => {
    try {
      await execFileAsync(process.execPath, [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        '--resume',
        'session-1',
        'hello'
      ], {
        env: cliEnv()
      })
      throw new Error('CLI unexpectedly succeeded')
    } catch (error) {
      expect((error as { code?: number }).code).toBe(1)
      expect(String((error as { stderr?: string }).stderr ?? '')).toContain('--resume can only be used with --repl.')
    }
  })

  it('rejects an invalid --port value', async () => {
    for (const portArg of ['abc', '--port=']) {
      const args =
        portArg === '--port='
          ? ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--web', portArg]
          : ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--web', '--port', portArg]

      try {
        await execFileAsync(process.execPath, args, {
          env: cliEnv()
        })
        throw new Error('CLI unexpectedly succeeded')
      } catch (error) {
        expect((error as { code?: number }).code).toBe(1)
        expect(String((error as { stderr?: string }).stderr ?? '')).toContain(
          '--port must be an integer from 0 to 65535.'
        )
      }
    }
  })

  it('prints config doctor output', async () => {
    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', process.cwd(), 'config', 'doctor'],
      {
        env: cliEnv({
          CYRENE_BASE_URL: 'https://api.example.com/v1',
          CYRENE_MODEL: 'strong-model',
          CYRENE_STRONG_MODEL: 'strong-model',
          CYRENE_CHEAP_MODEL: 'cheap-model',
          CYRENE_THINKING_MODE: 'auto',
          CYRENE_API_KEY: 'secret-key',
          CYRENE_ENABLE_BASH: '0'
        })
      }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Model:')
    expect(result.stdout).toContain('baseUrl: https://api.example.com/v1')
    expect(result.stdout).toContain('model: strong-model')
    expect(result.stdout).toContain('provider: openai-compatible')
    expect(result.stdout).toContain('strongModel: strong-model')
    expect(result.stdout).toContain('cheapModel: cheap-model')
    expect(result.stdout).toContain('thinkingMode: auto')
    expect(result.stdout).toContain('interactiveContext: 256000 tokens')
    expect(result.stdout).toContain('apiKey: configured')
    expect(result.stdout).toContain('enabled: file_read, file_write, file_edit, grep, glob, ask_user, web_search')
    expect(result.stdout).toContain('disabled: bash, mcp')
    expect(result.stdout).toContain('T2I: removed from runtime')
  })

  it('warns when remote HTTPS model config has no API key', async () => {
    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', process.cwd(), 'config', 'doctor'],
      {
        env: cliEnv({
          CYRENE_BASE_URL: 'https://api.example.com/v1',
          CYRENE_MODEL: 'strong-model',
          CYRENE_API_KEY: ''
        })
      }
    )

    expect(result.stdout).toContain('warning: CYRENE_API_KEY is not set for remote HTTPS endpoint')
  })

  it('prints limited memory events from the memory subcommand', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cyrene-main-memory-events-'))
    const memoryDir = join(root, '.cyrene', 'memory')
    await mkdir(memoryDir, { recursive: true })
    await writeFile(
      join(memoryDir, 'events.jsonl'),
      [
        JSON.stringify({
          id: 'event-1',
          action: 'create',
          at: '2026-05-23T00:00:00.000Z',
          reason: 'first event'
        }),
        JSON.stringify({
          id: 'event-2',
          action: 'pending',
          at: '2026-05-23T00:01:00.000Z',
          reason: 'second event'
        })
      ].join('\n') + '\n'
    )

    try {
      const repo = process.cwd()
      const result = await execFileAsync(
        process.execPath,
        [join(repo, 'node_modules/tsx/dist/cli.mjs'), join(repo, 'src/main.ts'), '--cwd', root, 'memory', 'events', '--limit', '1'],
        { cwd: root, env: cliEnv() }
      )

      expect(result.stderr).toBe('')
      expect(JSON.parse(result.stdout)).toEqual([
        {
          id: 'event-2',
          action: 'pending',
          at: '2026-05-23T00:01:00.000Z',
          reason: 'second event'
        }
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the launch root for memory subcommands even when --cwd points at a workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cyrene-main-memory-root-'))
    const workspace = join(root, 'workspace')
    await mkdir(join(root, '.cyrene', 'memory'), { recursive: true })
    await mkdir(join(workspace, '.cyrene', 'memory'), { recursive: true })
    await writeFile(
      join(root, '.cyrene', 'memory', 'index.jsonl'),
      activeMemoryLine({
        id: 'root-memory',
        content: 'Root memory should be shared by CLI and Web.',
        normalizedKey: 'root-shared-memory'
      })
    )
    await writeFile(
      join(workspace, '.cyrene', 'memory', 'index.jsonl'),
      activeMemoryLine({
        id: 'workspace-memory',
        content: 'Workspace memory should not be used.',
        normalizedKey: 'workspace-memory'
      })
    )

    try {
      const repo = process.cwd()
      const result = await execFileAsync(
        process.execPath,
        [
          join(repo, 'node_modules/tsx/dist/cli.mjs'),
          join(repo, 'src/main.ts'),
          '--cwd',
          workspace,
          'memory',
          'list'
        ],
        { cwd: root, env: cliEnv() }
      )

      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('root-memory')
      expect(result.stdout).toContain('Root memory should be shared by CLI and Web.')
      expect(result.stdout).not.toContain('workspace-memory')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('starts the Web server and prints the local URL', async () => {
    const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--web', '--port', '0'], {
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const exitPromise = new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
    })

    let stdout = ''
    let stderr = ''

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for Web server output. stdout=${stdout} stderr=${stderr}`))
        }, 10_000)

        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8')
          if (/cyrene web listening at http:\/\/127\.0\.0\.1:\d+/.test(stdout)) {
            clearTimeout(timeout)
            resolve()
          }
        })
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8')
        })
        child.on('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        child.on('exit', (code) => {
          if (!stdout) {
            clearTimeout(timeout)
            reject(new Error(`CLI exited before printing URL with code ${code}. stderr=${stderr}`))
          }
        })
      })

      expect(stdout).toMatch(/cyrene web listening at http:\/\/127\.0\.0\.1:\d+\n/)
      expect(stderr).toBe('')
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill()
      }
      await exitPromise
    }
  }, 15_000)

  it('uses the main worktree local state when Web starts from a linked git worktree without workspace files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cyrene-main-linked-worktree-'))
    const mainRoot = join(root, 'main')
    const linkedWorktree = join(mainRoot, '.worktrees', 'feature')
    const repo = process.cwd()
    await mkdir(join(mainRoot, '.git', 'worktrees', 'feature'), { recursive: true })
    await mkdir(join(mainRoot, 'workspace'), { recursive: true })
    await mkdir(join(mainRoot, '.cyrene', 'sessions'), { recursive: true })
    await mkdir(linkedWorktree, { recursive: true })
    await writeFile(join(linkedWorktree, '.git'), `gitdir: ${join(mainRoot, '.git', 'worktrees', 'feature')}\n`, 'utf8')
    await writeFile(
      join(mainRoot, '.cyrene', 'sessions', 'index.json'),
      `${JSON.stringify([
        {
          id: 'existing-web-session',
          mode: 'web',
          title: 'Existing session',
          preview: 'history should load',
          createdAt: '2026-05-24T00:00:00.000Z',
          updatedAt: '2026-05-24T00:00:00.000Z',
          model: 'test-model',
          pinned: false
        }
      ])}\n`,
      'utf8'
    )

    const child = spawn(
      process.execPath,
      [join(repo, 'node_modules/tsx/dist/cli.mjs'), join(repo, 'src/main.ts'), '--web', '--port', '0'],
      {
        cwd: linkedWorktree,
        env: cliEnv(),
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    const exitPromise = new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
    })

    let stdout = ''
    let stderr = ''

    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for Web server output. stdout=${stdout} stderr=${stderr}`))
        }, 10_000)

        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8')
          const match = /cyrene web listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout)
          if (match !== null) {
            clearTimeout(timeout)
            resolve(match[1])
          }
        })
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8')
        })
        child.on('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        child.on('exit', (code) => {
          if (!stdout) {
            clearTimeout(timeout)
            reject(new Error(`CLI exited before printing URL with code ${code}. stderr=${stderr}`))
          }
        })
      })

      const [workspaceResponse, sessionsResponse] = await Promise.all([
        fetch(`${url}/api/workspaces`),
        fetch(`${url}/api/sessions`)
      ])

      expect(workspaceResponse.status).toBe(200)
      await expect(workspaceResponse.json()).resolves.toEqual({
        workspaces: [{ id: '', label: 'workspace', relativePath: 'workspace' }]
      })
      expect(sessionsResponse.status).toBe(200)
      await expect(sessionsResponse.json()).resolves.toEqual({
        sessions: [
          expect.objectContaining({
            id: 'existing-web-session',
            title: 'Existing session'
          })
        ]
      })
      expect(stderr).toBe('')
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill()
      }
      await exitPromise
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('appends soul, Rule.md stack, and typed memory to the system prompt', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cyrene-main-home-'))
    const root = join(home, 'workspace', 'project')
    const userCyreneDir = join(home, '.cyrene')
    await mkdir(join(root, '.cyrene'), { recursive: true })
    await mkdir(join(home, 'workspace', '.cyrene'), { recursive: true })
    await mkdir(join(userCyreneDir, 'memory'), { recursive: true })
    await writeFile(join(userCyreneDir, 'soul.md'), 'Be direct.\n')
    await writeFile(join(userCyreneDir, 'Rule.md'), 'Global rule.\n')
    await writeFile(join(home, 'workspace', '.cyrene', 'Rule.md'), 'Workspace rule.\n')
    await writeFile(join(root, '.cyrene', 'Rule.md'), 'Project rule.\n')
    await writeFile(join(root, '.cyrene', 'instructions.md'), 'Use TDD.\n')
    await mkdir(join(root, '.cyrene', 'memory'), { recursive: true })
    await writeFile(
      join(root, '.cyrene', 'memory', 'index.jsonl'),
      activeMemoryLine({
        id: 'code-style',
        content: 'Prefer small patches.',
        normalizedKey: 'prefer-small-patches'
      })
    )

    let requestBody: unknown
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        requestBody = JSON.parse(body) as unknown
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Expected TCP server address')
    }

    try {
      const repo = process.cwd()
      const result = await execFileAsync(
        process.execPath,
        [join(repo, 'node_modules/tsx/dist/cli.mjs'), join(repo, 'src/main.ts'), '--cwd', root, 'hello'],
        {
          cwd: root,
          env: cliEnv({
            HOME: home,
            CYRENE_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            CYRENE_MODEL: 'test-model'
          })
        }
      )

      expect(result.stdout.trim()).toBe('ok')
      expectOnlyTraceLine(result.stderr)
      const messages = (requestBody as { messages: Array<{ role: string; content: string }> }).messages
      expect(messages[1]).toEqual({ role: 'user', content: 'hello' })
      const systemPrompt = messages[0]?.content ?? ''
      const expectedOrder = [
        '## Global Persona\n\nBe direct.',
        '## Global Rule\n\nGlobal rule.',
        '## Rule:',
        'Workspace rule.',
        'Project rule.',
        '## Project Instructions\n\nUse TDD.',
        '## Relevant Memory\n- Prefer small patches.'
      ]
      let lastIndex = -1
      for (const expected of expectedOrder) {
        const index = systemPrompt.indexOf(expected)
        expect(index).toBeGreaterThan(lastIndex)
        lastIndex = index
      }
      expect(systemPrompt).not.toContain('Previous Session')
      expect(systemPrompt).not.toContain('Previous session summary')
      expect(systemPrompt).not.toContain('Recent Daily Memory')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
      await rm(home, { recursive: true, force: true })
    }
  })

  it('prints model errors without a Node stack trace', async () => {
    try {
      await execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'hello'],
        {
          env: cliEnv({
            CYRENE_BASE_URL: 'http://127.0.0.1:1/v1',
            CYRENE_MODEL: 'test-model'
          })
        }
      )
      throw new Error('CLI unexpectedly succeeded')
    } catch (error) {
      const stderr = String((error as { stderr?: string }).stderr ?? '')
      expect((error as { code?: number }).code).toBe(1)
      expect(stderr).toContain('LLM request failed: fetch failed')
      expect(stderr.trim()).toBe('LLM request failed: fetch failed')
      expect(stderr).not.toMatch(/\n\s*at\s+/)
    }
  })

  it('keeps the final one-shot answer on stdout and UI status on stderr', async () => {
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        const parsed = JSON.parse(body) as { messages: Array<{ role: string; content: string }> }
        const hasToolResult = parsed.messages.some((message) => message.role === 'tool')
        response.writeHead(200, { 'content-type': 'application/json' })

        if (!hasToolResult) {
          response.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: '',
                    tool_calls: [
                      {
                        id: 'call-1',
                        type: 'function',
                        function: {
                          name: 'glob',
                          arguments: JSON.stringify({ pattern: 'package.json' })
                        }
                      }
                    ]
                  }
                }
              ]
            })
          )
          return
        }

        response.end(JSON.stringify({ choices: [{ message: { content: 'final cli answer' } }] }))
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Expected TCP server address')
    }

    try {
      const result = await execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', process.cwd(), 'find package'],
        {
          env: cliEnv({
            CYRENE_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            CYRENE_MODEL: 'test-model'
          })
        }
      )

      expect(result.stdout).toContain('final cli answer')
      expect(result.stdout).not.toContain('glob')
      expect(result.stdout).not.toContain('tool calls:')
      expect(result.stderr).toContain('glob')
      expect(result.stderr).toContain('tool calls: 1')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  })

  it('creates a trace for one-shot runs and replays it from the CLI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cyrene-main-trace-'))
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: 'trace answer' } }] }))
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Expected TCP server address')
    }

    try {
      const result = await execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', root, 'hello trace'],
        {
          env: cliEnv({
            CYRENE_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            CYRENE_MODEL: 'test-model'
          })
        }
      )
      expect(result.stdout).toBe('trace answer\n')
      const traceLine = result.stderr.split('\n').find((line) => line.startsWith('trace: .cyrene/runs/'))
      expect(traceLine).toBeDefined()
      const runId = traceLine?.split('/').at(-1) ?? ''

      const replay = await execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', root, 'trace', 'replay', runId],
        { env: cliEnv() }
      )
      expect(replay.stderr).toBe('')
      expect(replay.stdout).toContain('user: hello trace')
      expect(replay.stdout).toContain('assistant: trace answer')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
      await rm(root, { recursive: true, force: true })
    }
  })

  it('prints final answer and tool-count metadata without ANSI color under FORCE_COLOR', async () => {
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        const parsed = JSON.parse(body) as { messages: Array<{ role: string; content: string }> }
        const hasToolResult = parsed.messages.some((message) => message.role === 'tool')
        response.writeHead(200, { 'content-type': 'application/json' })

        if (!hasToolResult) {
          response.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: '',
                    tool_calls: [
                      {
                        id: 'call-1',
                        type: 'function',
                        function: {
                          name: 'glob',
                          arguments: JSON.stringify({ pattern: 'package.json' })
                        }
                      }
                    ]
                  }
                }
              ]
            })
          )
          return
        }

        response.end(JSON.stringify({ choices: [{ message: { content: 'final cli answer' } }] }))
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Expected TCP server address')
    }

    try {
      const result = await execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', process.cwd(), 'find package'],
        {
          env: cliEnv({
            FORCE_COLOR: '1',
            CYRENE_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            CYRENE_MODEL: 'test-model'
          })
        }
      )

      expect(result.stdout).toBe('final cli answer\n')
      expect(result.stderr).toContain('glob')
      expect(result.stderr.split('\n').filter((line) => line.includes('tool calls:'))).toEqual(['tool calls: 1'])
      expect(result.stdout).not.toMatch(/\x1B\[[0-?]*[ -/]*[@-~]/)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  })

  it('does not compact legacy daily memory after a successful one-shot run', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cyrene-main-home-'))
    const root = join(home, 'workspace')
    const memoryDir = join(root, '.cyrene', 'memory')
    await mkdir(memoryDir, { recursive: true })
    const dailyContent = Array.from({ length: 500 }, (_, index) => `daily line ${index + 1}`).join('\n') + '\n'
    await writeFile(join(memoryDir, 'daily.md'), dailyContent)

    let requestCount = 0
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        requestCount += 1
        const parsed = JSON.parse(body) as { messages: Array<{ role: string; content: string }> }
        const prompt = parsed.messages.at(-1)?.content ?? ''
        response.writeHead(200, { 'content-type': 'application/json' })

        if (prompt.includes('Review the daily memory log')) {
          response.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      memories: [
                        {
                          title: 'Daily Project Fact',
                          file: 'daily-project-fact.md',
                          type: 'project',
                          summary: 'daily log reached compaction threshold',
                          content: 'Daily memory compaction ran after the CLI one-shot completed.\n'
                        }
                      ]
                    })
                  }
                }
              ]
            })
          )
          return
        }

        response.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Expected TCP server address')
    }

    try {
      const result = await execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', root, 'hello'],
        {
          env: cliEnv({
            HOME: home,
            CYRENE_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            CYRENE_MODEL: 'test-model'
          })
        }
      )

      expect(result.stdout.trim()).toBe('ok')
      expectOnlyTraceLine(result.stderr)
      expect(requestCount).toBe(1)
      await expect(readFile(join(memoryDir, 'daily.md'), 'utf8')).resolves.toBe(dailyContent)
      await expect(readFile(join(memoryDir, 'daily.archive.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(join(memoryDir, 'daily-project-fact.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
      await rm(home, { recursive: true, force: true })
    }
  })
})
