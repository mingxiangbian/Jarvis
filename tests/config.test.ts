import { describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/config.js'

describe('createDefaultConfig', () => {
  it('uses the local MLX OpenAI-compatible endpoint by default', () => {
    const config = createDefaultConfig('/tmp/project')

    expect(config.model.baseUrl).toBe('http://127.0.0.1:8080/v1')
    expect(config.model.model).toBe('Qwen3.5-9B-MLX-4bit')
    expect(config.model.temperature).toBe(0)
  })

  it('keeps v1 safety and context limits explicit', () => {
    const config = createDefaultConfig('/tmp/project')

    expect(config.cwd).toBe('/tmp/project')
    expect(config.maxToolCallsPerTurn).toBe(10)
    expect(config.readMaxInlineLines).toBe(500)
    expect(config.bashTimeoutMs).toBe(120_000)
    expect(config.writableRoots).toEqual(['/tmp/project'])
  })
})
