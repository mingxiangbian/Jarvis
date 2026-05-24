import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { createEvolutionProposal } from '../src/evolution/proposal-store.js'

const execFileAsync = promisify(execFile)

function cliEnv(): NodeJS.ProcessEnv {
  const { FORCE_COLOR: _forceColor, NO_COLOR: _noColor, ...env } = process.env
  return { ...env, CYRENE_MEMORY_AUTO_EXTRACT: '0' }
}

describe('evolution CLI', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  async function createTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'cyrene-evolution-cli-'))
    tempDirs.push(dir)
    return dir
  }

  it('runs deterministic eval suites and prints JSON reports', async () => {
    const cwd = await createTempDir()
    const repo = process.cwd()

    const result = await execFileAsync(
      process.execPath,
      [join(repo, 'node_modules/tsx/dist/cli.mjs'), join(repo, 'src/main.ts'), '--cwd', cwd, 'eval', '--suite', 'memory', '--json'],
      { cwd: repo, env: cliEnv() }
    )

    expect(result.stderr).toBe('')
    const report = JSON.parse(result.stdout) as {
      passed: boolean
      suites: Record<string, unknown>
      results: Array<{ suite: string }>
    }
    expect(report.passed).toBe(true)
    expect(Object.keys(report.suites)).toEqual(['memory'])
    expect(report.results.length).toBeGreaterThan(0)
    expect(report.results.every((entry) => entry.suite === 'memory')).toBe(true)
  })

  it('lists, inspects, approves, and rejects evolution proposals', async () => {
    const cwd = await createTempDir()
    const repo = process.cwd()
    const proposal = await createEvolutionProposal({
      cwd,
      proposal: {
        id: 'proposal-cli-1',
        type: 'procedural',
        risk: 'low',
        sourceRunIds: ['run-1'],
        evidence: ['eval passed'],
        summary: 'Use eval before evolution updates.',
        proposedChange: { content: 'Run eval before applying procedural updates.' },
        evalRunId: 'eval-1',
        approvalRequired: false,
        gateReason: 'eligible',
        status: 'eligible'
      },
      rationale: 'CLI smoke test.'
    })

    const list = await runEvolutionCommand(repo, cwd, ['list'])
    expect(list.stdout).toContain(`${proposal.id}\tprocedural\teligible\tlow\tUse eval before evolution updates.`)

    const inspect = await runEvolutionCommand(repo, cwd, ['inspect', proposal.id])
    expect(JSON.parse(inspect.stdout)).toMatchObject({ id: proposal.id, status: 'eligible' })

    const approve = await runEvolutionCommand(repo, cwd, ['approve', proposal.id])
    expect(JSON.parse(approve.stdout)).toMatchObject({ proposalId: proposal.id, status: 'approved' })

    const reject = await runEvolutionCommand(repo, cwd, ['reject', proposal.id, '--reason', 'needs a clearer source'])
    expect(JSON.parse(reject.stdout)).toMatchObject({
      proposalId: proposal.id,
      status: 'rejected',
      reason: 'needs a clearer source'
    })
  })

  it('creates gated proposals from natural-language CLI descriptions', async () => {
    const cwd = await createTempDir()
    const repo = process.cwd()

    const memory = await runEvolutionCommand(repo, cwd, [
      'propose',
      '请把低风险 memory 更新写入：CLI 自然语言验收通过后再记录。'
    ])
    expect(JSON.parse(memory.stdout).proposal).toMatchObject({
      type: 'memory',
      status: 'eligible',
      approvalRequired: false
    })

    const prompt = await runEvolutionCommand(repo, cwd, [
      'propose',
      '修改 system prompt：以后所有自进化都必须先通过 eval gate。'
    ])
    const promptProposal = JSON.parse(prompt.stdout).proposal as { id: string; type: string; status: string; approvalRequired: boolean }
    expect(promptProposal).toMatchObject({
      type: 'prompt',
      status: 'approval_required',
      approvalRequired: true
    })
    await expect(readFile(join(cwd, '.cyrene', 'proposals', promptProposal.id, 'prompt.patch.diff'), 'utf8')).resolves.toContain(
      'eval gate'
    )

    const permission = await runEvolutionCommand(repo, cwd, [
      'propose',
      '扩大 tool permission，允许自动提升 shell 权限。'
    ])
    expect(JSON.parse(permission.stdout).proposal).toMatchObject({
      type: 'permission',
      status: 'rejected',
      approvalRequired: false,
      gateReason: 'Unsupported proposal type: permission'
    })

    const toolUsage = await runEvolutionCommand(repo, cwd, [
      'propose',
      '记录一个 tool usage note：修改 prompt 前必须先查看 eval report。'
    ])
    expect(JSON.parse(toolUsage.stdout).proposal).toMatchObject({
      type: 'tool_usage_note',
      status: 'eligible',
      approvalRequired: false
    })

    const procedural = await runEvolutionCommand(repo, cwd, [
      'propose',
      '新增 procedural 流程：每次应用 prompt proposal 前先检查 approval.json。'
    ])
    expect(JSON.parse(procedural.stdout).proposal).toMatchObject({
      type: 'procedural',
      status: 'eligible',
      approvalRequired: false
    })
  })
})

async function runEvolutionCommand(repo: string, cwd: string, args: string[]) {
  const result = await execFileAsync(
    process.execPath,
    [join(repo, 'node_modules/tsx/dist/cli.mjs'), join(repo, 'src/main.ts'), '--cwd', cwd, 'evolution', ...args],
    { cwd: repo, env: cliEnv() }
  )
  expect(result.stderr).toBe('')
  return result
}
