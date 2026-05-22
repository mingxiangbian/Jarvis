# Jarvis

Local TypeScript agent runtime with a web UI, REPL mode, project-local memory, and file tools scoped to a workspace.

## Portability Status

The Node application is portable across normal Node environments. A local model server is required at runtime, but it only needs to expose an OpenAI-compatible chat completions API.

The included `server/start.sh` is a convenience launcher for an MLX/Qwen setup. That path is optional and is mainly useful on Apple Silicon machines with `mlx_lm` installed and the model files available locally.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- An OpenAI-compatible model endpoint
- Optional: Python plus `mlx_lm` if using `server/start.sh`

## Setup

```bash
npm ci
npm run setup
cp .env.example .env
```

`npm run setup` creates local runtime state that is intentionally not committed:

- `workspace/`
- `.jarvis/memory/daily.md`

Edit `.env` if your model endpoint or model name differs from the defaults.

## Run

Start the agent in one-shot or REPL mode:

```bash
npm run dev -- "Summarize this project"
npm run dev -- --repl
```

Start the web UI:

```bash
npm run dev -- --web
```

The web UI uses `workspace/` as its root. Create child directories inside `workspace/` if you want separate selectable workspaces.

## Model Endpoint

By default the app expects:

```bash
JARVIS_BASE_URL=http://127.0.0.1:8080/v1
JARVIS_MODEL=Qwen3.5-9B-MLX-4bit
```

Override those values in `.env` or your shell to point at any compatible server.

## Optional MLX Server

`server/start.sh` can launch the local MLX server. Defaults are preserved, but each setting can be overridden:

```bash
MODEL_PATH=/models/qwen HOST=0.0.0.0 PORT=8081 PYTHON=/opt/venv/bin/python ./server/start.sh
```

If no variables are provided, it uses:

- `MODEL_PATH=./Qwen3.5-9B-MLX-4bit`
- `HOST=127.0.0.1`
- `PORT=8080`
- `PYTHON=./.venv/bin/python`, falling back to `python3` or `python`

## Optional Local Image Generation

The agent can call a local SD1.5 text-to-image worker through the `generate_image` tool. The worker is optional; normal chat, REPL, and web UI flows still work without it.

Place local image assets under the ignored `T2I/` directory. The current defaults expect:

- `T2I/majicmixRealistic_v7.safetensors`
- `T2I/adetailer/face_yolov8n.pt`
- `T2I/adetailer/hand_yolov8n.pt`
- `T2I/adetailer/person_yolov8n-seg.pt`

Start the worker with:

```bash
./server/start-t2i.sh
```

The launcher creates and reuses `.venv-t2i`, installs `requirements-t2i.txt` when needed, and defaults to Hugging Face offline mode for local safetensors checkpoints. Detail detector dependencies remain opt-in:

```bash
T2I_INSTALL_DETAIL_DEPS=1 ./server/start-t2i.sh
```

Useful overrides:

```bash
T2I_BASE_URL=http://127.0.0.1:7861
T2I_MODEL_PATH=./T2I/majicmixRealistic_v7.safetensors
T2I_OUTPUT_DIR=generated-images
T2I_AUTO_START=1
T2I_START_COMMAND=./server/start-t2i.sh
T2I_START_TIMEOUT_MS=120000
T2I_GENERATE_TIMEOUT_MS=900000
T2I_FACE_DETECTOR_MODEL=./T2I/adetailer/face_yolov8n.pt
T2I_HAND_DETECTOR_MODEL=./T2I/adetailer/hand_yolov8n.pt
T2I_PERSON_DETECTOR_MODEL=./T2I/adetailer/person_yolov8n-seg.pt
```

Generated files are written under `T2I_OUTPUT_DIR`, resolved relative to the active workspace. In the web UI that means the selected workspace, so Markdown image links such as `![image](generated-images/example.png)` can be previewed through the workspace file viewer.

Before each generation, `generate_image` checks the worker `/health` endpoint. The health payload includes the loaded model, optional detail dependency availability, and configured detector model paths. Requests that need face, hand, or person refinement fail early when the required detector is missing. If the worker is already running, it is reused and left running. If it is unavailable and `T2I_AUTO_START` is enabled, the tool starts `T2I_START_COMMAND`, waits up to `T2I_START_TIMEOUT_MS`, generates the image with a `T2I_GENERATE_TIMEOUT_MS` timeout, then stops only the worker process it started. If auto-start is disabled or startup times out, the tool returns the manual start command and captured worker startup output in the error message.

The `generate_image` tool supports:

- base text-to-image parameters: `prompt`, `negative_prompt`, `width`, `height`, `steps`, `cfg_scale`, `seed`, `count`
- realism defaults with `realism_preset`
- M3-safe defaults with `safe_preset` enabled by default
- Dynamic Thresholding-style CFG control with `dynamic_thresholding`, `dynamic_thresholding_mimic_scale`, and `dynamic_thresholding_percentile`
- Hires-style upscaling with `hires_fix`, `hires_scale`, `hires_steps`, `hires_denoise`
- ADetailer-style local refinement with `detail_enhance`, `detail_targets`, `detail_strength`
- eye-area refinement with `eye_refine`, `eye_refine_strength`, `eye_refine_steps`
- lightweight BMAB-like postprocess with `bmab_postprocess`, `bmab_noise_alpha`, `bmab_contrast`, `bmab_brightness`, `bmab_color_temperature`

By default, `safe_preset` applies an M3 16 GB profile: 512x768 base generation, one image, 20 steps, CFG 7, hires 2x with 15 img2img steps, low denoise, face/eye refinement, BMAB-like postprocess, and Dynamic Thresholding metadata. Set `safe_preset` to `false` when you intentionally want manual dimensions, counts, CFG, or experimental settings.

The current hires path does not require ESRGAN, UltraSharp, or NMKD `.pth` upscaler weights. It uses deterministic local resizing followed by low-denoise img2img refinement. Real local upscaler weights should be added through a separate design once a specific weight file and dependency path are selected.

For realistic portraits, a conservative starting point is:

```json
{
  "width": 512,
  "height": 768,
  "steps": 20,
  "cfg_scale": 7,
  "hires_fix": true,
  "hires_scale": 2,
  "hires_steps": 15,
  "hires_denoise": 0.15,
  "detail_enhance": true,
  "detail_targets": "face",
  "detail_strength": 0.1,
  "eye_refine": true,
  "eye_refine_strength": 0.12,
  "eye_refine_steps": 12,
  "bmab_postprocess": true,
  "bmab_noise_alpha": 0.05,
  "bmab_contrast": 0.9,
  "bmab_brightness": 1.1,
  "bmab_color_temperature": 15
}
```

## Tests

```bash
npm run typecheck
npm test
```

The MLX tool-calling benchmark is not part of the default test suite because it needs local model weights and `mlx_lm`:

```bash
npm run benchmark:tool-calling
```
