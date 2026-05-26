import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { PendingMemory } from '../src/memory/types.js'

const execFileAsync = promisify(execFile)
const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function cliEnv(home: string): NodeJS.ProcessEnv {
  const { FORCE_COLOR: _forceColor, NO_COLOR: _noColor, ...env } = process.env
  return { ...env, HOME: home, CYRENE_MEMORY_AUTO_EXTRACT: '0' }
}

function createPending(): PendingMemory {
  return {
    id: 'cli-pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'CLI dream promotes repeated pending memory.',
    normalizedKey: 'cli-dream-promotes-pending',
    evidence: [
      { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
      { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
    ],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 2,
    firstSeenAt: '2026-05-25T00:00:00.000Z',
    lastSeenAt: '2026-05-25T01:00:00.000Z',
    expiresAt: '2026-06-24T00:00:00.000Z',
    tags: ['cli']
  }
}

describe('cyrene codex CLI', () => {
  it('doctor reports agentmemory as not ready when configured', async () => {
    const home = await createTempDir('cyrene-codex-cli-home-')
    await writeFile(
      join(home, '.codex-config.toml'),
      [
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        '',
        '[mcp_servers.cyrene]',
        'command = "cyrene"',
        'args = ["mcp-server", "--stdio"]'
      ].join('\n')
    )

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'doctor',
        '--config',
        join(home, '.codex-config.toml')
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Cyrene Codex Doctor')
    expect(result.stdout).toContain('cyrene mcp: configured')
    expect(result.stdout).toContain('agentmemory: enabled')
    expect(result.stdout).toContain('status: not ready')
  })

  it('doctor is not ready until the Cyrene skill is registered', async () => {
    const home = await createTempDir('cyrene-codex-cli-no-skill-home-')
    await writeFile(
      join(home, '.codex-config.toml'),
      [
        '[mcp_servers.cyrene]',
        'command = "cyrene"',
        'args = ["mcp-server", "--stdio"]',
        'enabled = true'
      ].join('\n')
    )

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'doctor',
        '--config',
        join(home, '.codex-config.toml')
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('cyrene mcp: configured')
    expect(result.stdout).toContain('agentmemory: disabled')
    expect(result.stdout).toContain('cyrene-continuity: missing')
    expect(result.stdout).toContain('status: not ready')
    expect(result.stdout).toContain('action: run cyrene codex install --dev')
  })

  it('doctor reports ready after the skill is installed and agentmemory is disabled', async () => {
    const home = await createTempDir('cyrene-codex-cli-ready-home-')
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene]',
        'command = "cyrene"',
        'args = ["mcp-server", "--stdio"]',
        'enabled = true',
        '',
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        'enabled = false'
      ].join('\n')
    )

    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )
    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'doctor',
        '--config',
        configPath
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('cyrene mcp: configured')
    expect(result.stdout).toContain('agentmemory: disabled')
    expect(result.stdout).toContain('cyrene-continuity: ok')
    expect(result.stdout).toContain('status: ready')
  })

  it('install --dev creates only the skill symlink and Cyrene Codex state root', async () => {
    const home = await createTempDir('cyrene-codex-install-home-')
    const codexConfig = join(home, '.codex', 'config.toml')
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(codexConfig, 'existing = true\n')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('[mcp_servers.cyrene]')
    expect(result.stdout).toContain('Disable agentmemory before validating Cyrene')
    await expect(readFile(join(home, '.agents', 'skills', 'cyrene-continuity', 'SKILL.md'), 'utf8')).resolves.toContain(
      'Cyrene Continuity Skill'
    )
    await expect(readFile(join(home, '.cyrene', 'codex', '.keep'), 'utf8')).resolves.toBe('created by cyrene codex install --dev\n')
    await expect(readFile(codexConfig, 'utf8')).resolves.toBe('existing = true\n')
  })

  it('install --dev refuses to replace an existing non-symlink skill path', async () => {
    const home = await createTempDir('cyrene-codex-install-existing-home-')
    const skillPath = join(home, '.agents', 'skills', 'cyrene-continuity')
    await mkdir(skillPath, { recursive: true })
    await writeFile(join(skillPath, 'SKILL.md'), 'custom skill\n')

    try {
      await execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
        { env: cliEnv(home) }
      )
      throw new Error('install unexpectedly succeeded')
    } catch (error) {
      expect((error as { code?: number }).code).toBe(1)
      expect(String((error as { stderr?: string }).stderr ?? '')).toContain('Refusing to replace existing non-symlink skill path')
    }

    await expect(readFile(join(skillPath, 'SKILL.md'), 'utf8')).resolves.toBe('custom skill\n')
  })

  it('install-hook --stop --dry-run does not write hooks.json', async () => {
    const home = await createTempDir('cyrene-codex-hook-dry-run-home-')
    const hooksPath = join(home, '.codex', 'hooks.json')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install-hook', '--stop', '--dry-run'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('dry-run')
    expect(result.stdout).toContain('codex hook stop')
    await expect(readFile(hooksPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('install-hook --stop writes hooks.json and preserves existing Stop hooks', async () => {
    const home = await createTempDir('cyrene-codex-hook-install-home-')
    const hooksPath = join(home, '.codex', 'hooks.json')
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(
      hooksPath,
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [{ type: 'command', command: '/Users/phoenix/.codex/hooks/task_done_sound.sh', timeout: 5 }]
              }
            ]
          }
        },
        null,
        2
      )
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install-hook', '--stop'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Codex Stop hook installed')
    const parsed = JSON.parse(await readFile(hooksPath, 'utf8')) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> }
    }
    const commands = parsed.hooks.Stop.flatMap((entry) => entry.hooks.map((hook) => hook.command))
    expect(commands).toContain('/Users/phoenix/.codex/hooks/task_done_sound.sh')
    expect(commands.filter((command) => command.includes('codex hook stop'))).toHaveLength(1)
  })

  it('doctor reports missing Stop hook as an advisory without blocking readiness', async () => {
    const home = await createTempDir('cyrene-codex-cli-stop-hook-advisory-home-')
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene]',
        'command = "cyrene"',
        'args = ["mcp-server", "--stdio"]',
        'enabled = true',
        '',
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        'enabled = false'
      ].join('\n')
    )
    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('status: ready')
    expect(result.stdout).toContain('stop hook: missing')
    expect(result.stdout).toContain('advisory: optional Stop hook is not installed')
  })

  it('doctor reports memory profile and dream state without blocking readiness', async () => {
    const home = await createTempDir('cyrene-codex-cli-memory-doctor-home-')
    process.env.HOME = home
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene]',
        'command = "cyrene"',
        'args = ["mcp-server", "--stdio"]',
        'enabled = true',
        '',
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        'enabled = false'
      ].join('\n')
    )
    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )
    const identity = await identifyCodexProject(process.cwd())
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const globalMemoryRoot = codexGlobalMemoryRoot()
    await mkdir(projectMemoryRoot, { recursive: true })
    await mkdir(globalMemoryRoot, { recursive: true })
    await writeFile(join(globalMemoryRoot, 'MODEL_PROFILE.md'), '# Global Profile\n')
    await writeFile(
      join(projectMemoryRoot, 'dream-state.json'),
      JSON.stringify({ dreamDue: true, lastDreamAt: '2026-05-25T00:00:00.000Z' }) + '\n'
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('status: ready')
    expect(result.stdout).toContain('memory:')
    expect(result.stdout).toContain('global profile: present')
    expect(result.stdout).toContain('project profile: missing')
    expect(result.stdout).toContain('dream due: yes')
    expect(result.stdout).toContain('last dream: 2026-05-25T00:00:00.000Z')
    expect(result.stdout).toContain('auto promote: enabled')
  })

  it('runs memory dream from the CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-dream-home-')
    process.env.HOME = home
    const identity = await identifyCodexProject(process.cwd())
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), `${JSON.stringify(createPending())}\n`)

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'dream', '--stage', 'deep'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as { roots: Array<{ promoted: number }> }
    expect(parsed.roots.some((root) => root.promoted === 1)).toBe(true)
  })

  it('rejects memory dream --stage without a value', async () => {
    const home = await createTempDir('cyrene-codex-cli-dream-home-')
    process.env.HOME = home

    await expect(
      execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'dream', '--stage'],
        { env: cliEnv(home) }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Invalid memory dream stage')
    })
  })

  it('prints effective memory profile from the CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-profile-home-')
    process.env.HOME = home
    const identity = await identifyCodexProject(process.cwd())
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const globalMemoryRoot = codexGlobalMemoryRoot()
    await mkdir(projectMemoryRoot, { recursive: true })
    await mkdir(globalMemoryRoot, { recursive: true })
    await writeFile(join(globalMemoryRoot, 'MODEL_PROFILE.md'), '# Cyrene Model Profile\n\n- Global profile.\n')
    await writeFile(join(projectMemoryRoot, 'MODEL_PROFILE.md'), '# Cyrene Model Profile\n\n- Project profile.\n')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'profile'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Global profile.')
    expect(result.stdout).toContain('Project profile.')
  })
})
