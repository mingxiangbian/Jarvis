import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonText } from '../src/mcp/mcp-json.js'
import { createCyreneMcpServer } from '../src/mcp/mcp-server.js'
import { handleMemoryPropose } from '../src/mcp/tools/memory-propose.js'
import {
  handleMemoryPendingGet,
  handleMemoryPendingList,
  handleMemoryPromote,
  handleMemoryReject
} from '../src/mcp/tools/memory-review.js'

const execFileAsync = promisify(execFile)
const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function cliEnv(): NodeJS.ProcessEnv {
  const { FORCE_COLOR: _forceColor, NO_COLOR: _noColor, ...env } = process.env
  return { ...env, CYRENE_MEMORY_AUTO_EXTRACT: '0' }
}

describe('Cyrene MCP server', () => {
  it('creates a named MCP server', () => {
    const server = createCyreneMcpServer({ cwd: process.cwd() })

    expect(server).toBeDefined()
  })

  it('formats JSON as MCP text content', () => {
    expect(jsonText({ ok: true })).toEqual({
      content: [
        {
          type: 'text',
          text: '{\n  "ok": true\n}'
        }
      ]
    })
  })

  it('handles memory propose as MCP JSON text', async () => {
    const home = await createTempDir('cyrene-mcp-memory-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-mcp-memory-project-')

    const result = await handleMemoryPropose(
      {
        cwd,
        candidate: {
          domain: 'procedural',
          type: 'procedural_rule',
          content: 'Codex memory proposals stay pending.',
          evidence: [{ runId: 'mcp-run-1', summary: 'MCP test.' }]
        }
      },
      process.cwd()
    )

    expect(result.content[0]?.type).toBe('text')
    expect(result.content[0]?.text).toContain('"action": "pending"')
  })

  it('handles pending memory review MCP actions', async () => {
    const home = await createTempDir('cyrene-mcp-memory-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-mcp-memory-review-project-')

    const proposed = await handleMemoryPropose(
      {
        cwd,
        candidate: {
          domain: 'project',
          type: 'project_fact',
          content: 'Pending memory review tools are exposed through MCP.',
          evidence: [{ runId: 'mcp-review-run-1', summary: 'MCP review test.' }]
        }
      },
      process.cwd()
    )
    const proposedJson = JSON.parse(proposed.content[0]?.text ?? '{}')
    const candidateId = proposedJson.result.candidateId
    const reviewHash = proposedJson.result.review.reviewHash

    const listJson = JSON.parse((await handleMemoryPendingList({ cwd }, process.cwd())).content[0]?.text ?? '{}')
    expect(listJson.total).toBe(1)

    const getJson = JSON.parse((await handleMemoryPendingGet({ cwd, id: candidateId }, process.cwd())).content[0]?.text ?? '{}')
    expect(getJson.result.action).toBe('get')

    const rejectJson = JSON.parse(
      (await handleMemoryReject({ cwd, id: candidateId, reviewHash, reason: 'Covered by MCP test.' }, process.cwd()))
        .content[0]?.text ?? '{}'
    )
    expect(rejectJson.result.action).toBe('reject')

    const promoteJson = JSON.parse(
      (await handleMemoryPromote({ cwd, id: candidateId, reviewHash, reason: 'Covered by MCP test.' }, process.cwd()))
        .content[0]?.text ?? '{}'
    )
    expect(promoteJson.result.action).toBe('not_found')
  })

  it('accepts mcp-server as a local CLI command without treating it as a prompt', async () => {
    try {
      await execFileAsync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'mcp-server', '--http'], {
        env: cliEnv()
      })
      throw new Error('CLI unexpectedly succeeded')
    } catch (error) {
      expect((error as { code?: number }).code).toBe(1)
      const stderr = String((error as { stderr?: string }).stderr ?? '')
      expect(stderr).toContain('Usage: cyrene mcp-server --stdio')
      expect(stderr).not.toContain('Prompt cannot be empty.')
    }
  })
})
