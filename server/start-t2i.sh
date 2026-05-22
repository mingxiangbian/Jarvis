#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${T2I_VENV:-${ROOT_DIR}/.venv-t2i}"
PYTHON="${T2I_PYTHON:-${VENV}/bin/python}"
HOST="${T2I_HOST:-${HOST:-127.0.0.1}}"
PORT="${T2I_PORT:-${PORT:-7861}}"
MODEL_PATH="${T2I_MODEL_PATH:-${ROOT_DIR}/T2I/majicmixRealistic_v7.safetensors}"
FACE_DETECTOR_MODEL="${T2I_FACE_DETECTOR_MODEL:-${ROOT_DIR}/T2I/adetailer/face_yolov8n.pt}"
HAND_DETECTOR_MODEL="${T2I_HAND_DETECTOR_MODEL:-${ROOT_DIR}/T2I/adetailer/hand_yolov8n.pt}"
PERSON_DETECTOR_MODEL="${T2I_PERSON_DETECTOR_MODEL:-${ROOT_DIR}/T2I/adetailer/person_yolov8n-seg.pt}"

if [[ ! -x "${PYTHON}" ]]; then
  BASE_PYTHON="${T2I_BASE_PYTHON:-python3}"
  "${BASE_PYTHON}" -m venv "${VENV}"
  PYTHON="${VENV}/bin/python"
fi

if ! "${PYTHON}" - <<'PY' >/dev/null 2>&1
import importlib.util
import sys

required = ["torch", "diffusers", "accelerate", "safetensors", "PIL"]
if any(importlib.util.find_spec(name) is None for name in required):
    sys.exit(1)

import transformers
if int(transformers.__version__.split(".", 1)[0]) >= 5:
    sys.exit(1)
PY
then
  "${PYTHON}" -m pip install -r "${ROOT_DIR}/requirements-t2i.txt"
fi

if [[ "${T2I_INSTALL_DETAIL_DEPS:-0}" == "1" ]]; then
  if ! "${PYTHON}" - <<'PY' >/dev/null 2>&1
import importlib.util
import sys

if importlib.util.find_spec("ultralytics") is None:
    sys.exit(1)
PY
  then
    "${PYTHON}" -m pip install -r "${ROOT_DIR}/requirements-t2i-detail.txt"
  fi
fi

export T2I_FACE_DETECTOR_MODEL="${FACE_DETECTOR_MODEL}"
export T2I_HAND_DETECTOR_MODEL="${HAND_DETECTOR_MODEL}"
export T2I_PERSON_DETECTOR_MODEL="${PERSON_DETECTOR_MODEL}"
export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}"

exec "${PYTHON}" "${ROOT_DIR}/scripts/t2i-worker.py" \
  --host "${HOST}" \
  --port "${PORT}" \
  --model-path "${MODEL_PATH}"
