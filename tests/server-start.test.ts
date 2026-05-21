import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('server/start.sh', () => {
  it('uses the mlx_lm server subcommand', async () => {
    const script = await readFile('server/start.sh', 'utf8')

    expect(script).toMatch(/-m mlx_lm server\s+\\/)
    expect(script).not.toMatch(/-m mlx_lm serve\s+\\/)
  })

  it('allows runtime settings to be overridden by environment variables', async () => {
    const script = await readFile('server/start.sh', 'utf8')

    expect(script).toContain('MODEL_PATH="${MODEL_PATH:-')
    expect(script).toContain('HOST="${HOST:-127.0.0.1}"')
    expect(script).toContain('PORT="${PORT:-8080}"')
    expect(script).toContain('PYTHON="${PYTHON:-')
    expect(script).toContain('--host "${HOST}"')
    expect(script).toContain('--port "${PORT}"')
  })
})

describe('server/start-t2i.sh', () => {
  it('uses an isolated T2I virtualenv and worker script', async () => {
    const script = await readFile('server/start-t2i.sh', 'utf8')

    expect(script).toContain('.venv-t2i')
    expect(script).toContain('requirements-t2i.txt')
    expect(script).toContain('scripts/t2i-worker.py')
    expect(script).toContain('T2I_MODEL_PATH')
    expect(script).toContain('majicmixRealistic_v7.safetensors')
    expect(script).not.toContain('PYTHON="${PYTHON:-${ROOT_DIR}/.venv/bin/python}"')
  })
})
