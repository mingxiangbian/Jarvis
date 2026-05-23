import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'

const rootDir = process.cwd()
const cyreneDir = join(rootDir, '.cyrene')
const memoryDir = join(cyreneDir, 'memory')

await mkdir(join(rootDir, 'workspace'), { recursive: true })
await mkdir(cyreneDir, { recursive: true })
await mkdir(memoryDir, { recursive: true })

const soulFile = await open(join(cyreneDir, 'Soul.md'), 'a')
await soulFile.close()

const ruleFile = await open(join(cyreneDir, 'Rule.md'), 'a')
await ruleFile.close()

const dailyFile = await open(join(memoryDir, 'daily.md'), 'a')
await dailyFile.close()
