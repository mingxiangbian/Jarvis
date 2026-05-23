# Cyrene

API-first TypeScript agent runtime with a web UI, REPL mode, project-local memory, model routing, and file tools scoped to a workspace.

## Repository

- GitHub: `https://github.com/mingxiangbian/Cyrene`
- Local checkout: `/Users/phoenix/Assistant/Cyrene`
- Project state: `.cyrene/`
- Global state: `~/.cyrene/`

## Portability Status

The Node application is portable across normal Node environments. A configured model endpoint is required at runtime. Generic providers only need to expose an OpenAI-compatible chat completions API; DeepSeek receives provider-specific request and response handling for thinking mode, reasoning replay, usage metadata, and the larger model context window.

The included `server/start.sh` is a convenience launcher for an MLX/Qwen setup. That path is an optional local fallback and is mainly useful on Apple Silicon machines with `mlx_lm` installed and the model files available locally.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- An OpenAI-compatible or DeepSeek model endpoint
- Optional: Python plus `mlx_lm` if using `server/start.sh`

## Setup

```bash
npm ci
npm run setup
cp .env.example .env
```

`npm run setup` creates local runtime state that is intentionally not committed:

- `workspace/`
- `.cyrene/Soul.md`
- `.cyrene/Rule.md`
- `.cyrene/memory/daily.md`

Project persona and rules are read from `.cyrene/Soul.md` and `.cyrene/Rule.md`. Project daily memory is stored in `.cyrene/memory/daily.md`. Global persona, rules, and global memories are read from `~/.cyrene/` when those files exist.

Edit `.env` before running agent tasks. `CYRENE_BASE_URL` and `CYRENE_MODEL` are required; `CYRENE_API_KEY` is optional for local servers and usually required for remote HTTPS endpoints.

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

Set these values in `.env` or your shell:

```bash
CYRENE_BASE_URL=https://api.example.com/v1
CYRENE_MODEL=strong-model-name
CYRENE_API_KEY=provider-key-if-needed
CYRENE_MODEL_PROVIDER=
CYRENE_STRONG_MODEL=
CYRENE_CHEAP_MODEL=
CYRENE_THINKING_MODE=auto
```

Missing `CYRENE_BASE_URL` or `CYRENE_MODEL` fails fast before the first model request. A remote HTTPS endpoint without `CYRENE_API_KEY` is allowed, but `config doctor` prints a warning because most hosted APIs require a bearer token.

`CYRENE_MODEL_PROVIDER` is optional. Cyrene auto-detects DeepSeek from `CYRENE_BASE_URL=https://api.deepseek.com`; set it explicitly to `deepseek` or `openai-compatible` only when auto-detection is not enough.

`CYRENE_STRONG_MODEL` is used for interactive chat, planning, coding, and reflection routes. `CYRENE_CHEAP_MODEL` is used for lightweight background work such as summarization and memory extraction. Leave either value empty to fall back to `CYRENE_MODEL`. Cheap routes run with thinking disabled to reduce latency and cost.

`CYRENE_THINKING_MODE` accepts `auto`, `on`, or `off`. The web UI also exposes this as a compact `Think: Auto/On/Off` menu in the composer. When using DeepSeek, `off` sends `thinking: { "type": "disabled" }`; `auto` and `on` preserve reasoning metadata for later tool-call turns when the provider returns it.

DeepSeek example:

```bash
CYRENE_BASE_URL=https://api.deepseek.com
CYRENE_MODEL=deepseek-v4-pro
CYRENE_API_KEY=sk-...
CYRENE_STRONG_MODEL=deepseek-v4-pro
CYRENE_CHEAP_MODEL=deepseek-v4-flash
CYRENE_THINKING_MODE=auto
```

## Config Doctor

Check the effective runtime configuration with:

```bash
npm run dev -- config doctor
```

The doctor reports model endpoint fields, provider routing, strong and cheap model names, thinking mode, active interactive context window, configured tool flags, the optional local fallback script, and the current image-generation status.

## Context And Web UI

The web UI uses the active model route to estimate context usage. Known DeepSeek V4 models currently report a 1,048,576 token context window in Cyrene, while unknown OpenAI-compatible models fall back to `contextWindowTokens` from the app config.

The context inspector refreshes Markdown files after successful file mutations, including `file_write`, `file_edit`, `file_delete`, and common shell file operations. Supported Markdown image previews include PNG, JPEG, WebP, and GIF files inside the selected workspace.

## Feature Flags

Core tool flags are manual startup-time settings. When a flag is disabled, that tool is omitted from the tool schema sent to the model:

```bash
CYRENE_ENABLE_BASH=1
CYRENE_ENABLE_WEB_SEARCH=1
CYRENE_ENABLE_MCP=0
```

`bash` and `web_search` default to enabled. `mcp` defaults to disabled until MCP capability wiring is added.

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

## Image Generation

Legacy local T2I support has been removed from runtime. There is no built-in `generate_image` tool and no Web image-generation toggle, because there is no image-generation capability to expose.

Future image generation should be added through the capability/plugin system so the provider, API key, local model path, and tool schema can be owned by that plugin instead of hard-coded into the core runtime.

## Tests

```bash
npm run typecheck
npm test
```

The MLX tool-calling benchmark is not part of the default test suite because it needs local model weights and `mlx_lm`:

```bash
npm run benchmark:tool-calling
```
