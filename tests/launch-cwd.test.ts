import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDefaultWebCwd } from '../src/launch-cwd.js'

describe('launch cwd helpers', () => {
  it('defaults the Web workspace boundary to the user home folder', () => {
    expect(resolveDefaultWebCwd('/tmp/cyrene-launch-root')).toBe(resolve(homedir()))
  })
})
