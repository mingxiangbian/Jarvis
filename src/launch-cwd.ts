import { homedir } from 'node:os'
import { resolve } from 'node:path'

export function resolveDefaultWebCwd(_launchCwd: string): string {
  return resolve(homedir())
}
