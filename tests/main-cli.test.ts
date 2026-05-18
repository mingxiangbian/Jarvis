import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('main CLI', () => {
  it('appends soul, Rule.md stack, project/global memories, and daily memory to the system prompt', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cc-local-main-home-'))
    const root = join(home, 'workspace', 'project')
    const userCcLocalDir = join(home, '.cc-local')
    await mkdir(join(root, '.cc-local'), { recursive: true })
    await mkdir(join(home, 'workspace', '.cc-local'), { recursive: true })
    await mkdir(join(userCcLocalDir, 'memory'), { recursive: true })
    await writeFile(join(userCcLocalDir, 'soul.md'), 'Be direct.\n')
    await writeFile(join(userCcLocalDir, 'Rule.md'), 'Global rule.\n')
    await writeFile(join(home, 'workspace', '.cc-local', 'Rule.md'), 'Workspace rule.\n')
    await writeFile(join(root, '.cc-local', 'Rule.md'), 'Project rule.\n')
    await writeFile(join(root, '.cc-local', 'instructions.md'), 'Use TDD.\n')
    await mkdir(join(root, '.cc-local', 'memory', 'sessions'), { recursive: true })
    await writeFile(join(root, '.cc-local', 'memory', 'MEMORY.md'), '- [Code Style](style.md) — local style\n')
    await writeFile(join(root, '.cc-local', 'memory', 'style.md'), 'Prefer small patches.\n')
    await writeFile(join(userCcLocalDir, 'memory', 'MEMORY.md'), '- [Global Memory](global.md) — global fact\n')
    await writeFile(join(userCcLocalDir, 'memory', 'global.md'), 'Remember global fact.\n')
    await writeFile(join(root, '.cc-local', 'memory', 'daily.md'), 'recent one\nrecent two\n')
    await writeFile(join(root, '.cc-local', 'memory', 'sessions', '2026-05-12.md'), 'Previous session summary.\n')

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
      const result = await execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', root, 'hello'],
        {
          env: {
            ...process.env,
            HOME: home,
            CC_LOCAL_BASE_URL: `http://127.0.0.1:${address.port}/v1`
          }
        }
      )

      expect(result.stdout.trim()).toBe('ok')
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
        '## Project Memory: Code Style\n\nPrefer small patches.',
        '## Global Memory: Global Memory\n\nRemember global fact.',
        '## Recent Daily Memory\n\nrecent one\nrecent two'
      ]
      let lastIndex = -1
      for (const expected of expectedOrder) {
        const index = systemPrompt.indexOf(expected)
        expect(index).toBeGreaterThan(lastIndex)
        lastIndex = index
      }
      expect(systemPrompt).not.toContain('Previous Session')
      expect(systemPrompt).not.toContain('Previous session summary')
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
          env: {
            ...process.env,
            CC_LOCAL_BASE_URL: 'http://127.0.0.1:1/v1'
          }
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
          env: {
            ...process.env,
            CC_LOCAL_BASE_URL: `http://127.0.0.1:${address.port}/v1`
          }
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
})
