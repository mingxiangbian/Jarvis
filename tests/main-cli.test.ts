import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('main CLI', () => {
  it('appends cwd project instructions, memories, and recent summaries to the system prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cc-local-main-'))
    await mkdir(join(root, '.cc-local'))
    await writeFile(join(root, '.cc-local', 'instructions.md'), 'Use TDD.\n')
    await mkdir(join(root, '.cc-local', 'memory', 'sessions'), { recursive: true })
    await writeFile(join(root, '.cc-local', 'memory', 'MEMORY.md'), '- [Code Style](style.md) — local style\n')
    await writeFile(join(root, '.cc-local', 'memory', 'style.md'), 'Prefer small patches.\n')
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
            CC_LOCAL_BASE_URL: `http://127.0.0.1:${address.port}/v1`
          }
        }
      )

      expect(result.stdout.trim()).toBe('ok')
      expect(requestBody).toMatchObject({
        messages: [
          {
            role: 'system',
            content: expect.stringMatching(
              /\n\n## Project Instructions\n\nUse TDD\.\n\n\n## Memory: Code Style\n\nPrefer small patches\.\n\n## Previous Session: 2026-05-12\n\nPrevious session summary\.$/
            )
          },
          { role: 'user', content: 'hello' }
        ]
      })
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
      expect(stderr.trim()).toBe('LLM request failed: fetch failed')
    }
  })
})
