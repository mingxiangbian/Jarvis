import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { codexGlobalRoot } from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'

export async function formatCodexDoctor(input: { cwd: string; configPath?: string }): Promise<string> {
  const configPath = input.configPath ?? join(homedir(), '.codex', 'config.toml')
  const configText = await readOptional(configPath)
  const cyreneConfigured = configText.includes('[mcp_servers.cyrene]')
  const agentmemoryEnabled = hasEnabledMcpServer(configText, 'agentmemory')
  const skillPath = join(homedir(), '.agents', 'skills', 'cyrene-continuity', 'SKILL.md')
  const skillExists = await pathExists(skillPath)
  const identity = await identifyCodexProject(input.cwd)
  const actions = [
    cyreneConfigured ? undefined : '  action: add [mcp_servers.cyrene] to Codex config',
    agentmemoryEnabled
      ? '  action: disable [mcp_servers.agentmemory] before validating Cyrene as the authoritative memory source'
      : undefined,
    skillExists ? undefined : '  action: run cyrene codex install --dev to register the cyrene-continuity skill'
  ].filter((action): action is string => action !== undefined)
  const ready = actions.length === 0

  return [
    'Cyrene Codex Doctor',
    '',
    'runtime:',
    `  node: ${process.versions.node}`,
    '',
    'codex:',
    `  config: ${configText === '' ? 'missing' : configPath}`,
    `  cyrene mcp: ${cyreneConfigured ? 'configured' : 'missing'}`,
    `  agentmemory: ${agentmemoryEnabled ? 'enabled' : 'disabled'}`,
    `  status: ${ready ? 'ready' : 'not ready'}`,
    ...actions,
    '',
    'skill:',
    `  cyrene-continuity: ${skillExists ? 'ok' : 'missing'}`,
    '',
    'state:',
    `  codex root: ${codexGlobalRoot()}`,
    `  projectId: ${identity.projectId}`,
    `  displayName: ${identity.displayName}`
  ].filter((line) => line !== '').join('\n') + '\n'
}

function hasEnabledMcpServer(configText: string, name: string): boolean {
  const block = readTomlBlock(configText, `[mcp_servers.${name}]`)
  if (block === undefined) {
    return false
  }
  return !/^\s*enabled\s*=\s*false\s*$/m.test(block)
}

function readTomlBlock(configText: string, heading: string): string | undefined {
  const lines = configText.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start < 0) {
    return undefined
  }
  const body: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      break
    }
    body.push(lines[index])
  }
  return body.join('\n')
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
