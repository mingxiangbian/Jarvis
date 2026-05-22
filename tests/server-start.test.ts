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

  it('keeps detail detector dependencies opt-in', async () => {
    const script = await readFile('server/start-t2i.sh', 'utf8')

    expect(script).toMatch(
      /if \[\[ "\$\{T2I_INSTALL_DETAIL_DEPS:-0\}" == "1" \]\]; then[\s\S]*find_spec\("ultralytics"\)[\s\S]*pip install -r "\$\{ROOT_DIR\}\/requirements-t2i-detail\.txt"[\s\S]*fi/,
    )
  })

  it('provides absolute default detector model paths', async () => {
    const script = await readFile('server/start-t2i.sh', 'utf8')

    expect(script).toContain('FACE_DETECTOR_MODEL="${T2I_FACE_DETECTOR_MODEL:-${ROOT_DIR}/T2I/adetailer/face_yolov8n.pt}"')
    expect(script).toContain('HAND_DETECTOR_MODEL="${T2I_HAND_DETECTOR_MODEL:-${ROOT_DIR}/T2I/adetailer/hand_yolov8n.pt}"')
    expect(script).toContain('PERSON_DETECTOR_MODEL="${T2I_PERSON_DETECTOR_MODEL:-${ROOT_DIR}/T2I/adetailer/person_yolov8n-seg.pt}"')
  })

  it('exports detector model paths for the worker', async () => {
    const script = await readFile('server/start-t2i.sh', 'utf8')

    expect(script).toContain('export T2I_FACE_DETECTOR_MODEL="${FACE_DETECTOR_MODEL}"')
    expect(script).toContain('export T2I_HAND_DETECTOR_MODEL="${HAND_DETECTOR_MODEL}"')
    expect(script).toContain('export T2I_PERSON_DETECTOR_MODEL="${PERSON_DETECTOR_MODEL}"')
  })

  it('defaults to Hugging Face offline mode for local safetensors models', async () => {
    const script = await readFile('server/start-t2i.sh', 'utf8')

    expect(script).toContain('export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}"')
  })
})
