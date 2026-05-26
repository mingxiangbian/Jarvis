import { mkdir, open, rm } from 'node:fs/promises'
import { join } from 'node:path'

const rootDir = process.cwd()
const cyreneDir = join(rootDir, '.cyrene')
const memoryDir = join(cyreneDir, 'memory')
const snapshotsDir = join(memoryDir, 'snapshots')
const legacyWorkspaceMemoryDir = join(rootDir, 'workspace', '.cyrene', 'memory')

await mkdir(join(rootDir, 'workspace'), { recursive: true })
await mkdir(cyreneDir, { recursive: true })
await mkdir(memoryDir, { recursive: true })
await mkdir(snapshotsDir, { recursive: true })
await rm(legacyWorkspaceMemoryDir, { recursive: true, force: true })

const soulFile = await open(join(cyreneDir, 'Soul.md'), 'a')
await soulFile.close()

const ruleFile = await open(join(cyreneDir, 'Rule.md'), 'a')
await ruleFile.close()
