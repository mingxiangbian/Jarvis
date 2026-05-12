#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_PATH="${ROOT_DIR}/Qwen3.5-9B-MLX-4bit"

python -m mlx_lm serve \
  --model "${MODEL_PATH}" \
  --host 127.0.0.1 \
  --port 8080
