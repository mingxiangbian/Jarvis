import { spawnSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { describe, expect, it } from 'vitest'

function resolveWorkerPython(): string {
  if (process.env.T2I_TEST_PYTHON) {
    return process.env.T2I_TEST_PYTHON
  }

  try {
    accessSync('.venv-t2i/bin/python', constants.X_OK)
    return '.venv-t2i/bin/python'
  } catch {
    return 'python3'
  }
}

const workerPython = resolveWorkerPython()

function runWorkerSnippet(source: string): string {
  const result = spawnSync(workerPython, ['-c', source], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1'
    }
  })
  if (result.status !== 0) {
    throw new Error(`python failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return result.stdout.trim()
}

function workerPythonHasPillow(): boolean {
  const result = spawnSync(workerPython, ['-c', 'import PIL'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1'
    }
  })
  return result.status === 0
}

function workerPythonHasTorch(): boolean {
  const result = spawnSync(workerPython, ['-c', 'import torch'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1'
    }
  })
  return result.status === 0
}

const pillowIt = workerPythonHasPillow() ? it : it.skip
const torchIt = workerPythonHasTorch() ? it : it.skip
const pillowAndTorchIt = workerPythonHasPillow() && workerPythonHasTorch() ? it : it.skip

const importWorker = `
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("t2i_worker", Path("scripts/t2i-worker.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
`

describe('t2i worker payload parsing', () => {
  it('defaults detail enhancement fields', () => {
    const output = runWorkerSnippet(`${importWorker}
payload = {"prompt": "portrait", "output_dir": "/tmp/generated-images"}
request, error = worker.validate_payload(payload)
assert error is None
print(json.dumps({
    "realism_preset": request["realism_preset"],
    "hires_fix": request["hires_fix"],
    "hires_scale": request["hires_scale"],
    "hires_steps": request["hires_steps"],
    "hires_denoise": request["hires_denoise"],
    "bmab_postprocess": request["bmab_postprocess"],
    "bmab_noise_alpha": request["bmab_noise_alpha"],
    "bmab_contrast": request["bmab_contrast"],
    "bmab_brightness": request["bmab_brightness"],
    "bmab_color_temperature": request["bmab_color_temperature"],
    "eye_refine": request["eye_refine"],
    "eye_refine_strength": request["eye_refine_strength"],
    "eye_refine_steps": request["eye_refine_steps"],
    "detail_enhance": request["detail_enhance"],
    "detail_targets": request["detail_targets"],
    "detail_strength": request["detail_strength"],
    "return_intermediate": request["return_intermediate"],
    "dynamic_thresholding": request["dynamic_thresholding"],
    "dynamic_thresholding_mimic_scale": request["dynamic_thresholding_mimic_scale"],
    "dynamic_thresholding_percentile": request["dynamic_thresholding_percentile"],
}))
`)

    expect(JSON.parse(output)).toEqual({
      realism_preset: false,
      hires_fix: false,
      hires_scale: 2,
      hires_steps: 15,
      hires_denoise: 0.15,
      bmab_postprocess: false,
      bmab_noise_alpha: 0.05,
      bmab_contrast: 0.9,
      bmab_brightness: 1.1,
      bmab_color_temperature: 15,
      eye_refine: false,
      eye_refine_strength: 0.12,
      eye_refine_steps: 12,
      detail_enhance: false,
      detail_targets: 'auto',
      detail_strength: 0.35,
      return_intermediate: false,
      dynamic_thresholding: false,
      dynamic_thresholding_mimic_scale: 7,
      dynamic_thresholding_percentile: 0.995
    })
  })

  it('accepts explicit dynamic thresholding fields', () => {
    const output = runWorkerSnippet(`${importWorker}
payload = {
    "prompt": "portrait",
    "output_dir": "/tmp/generated-images",
    "dynamic_thresholding": True,
    "dynamic_thresholding_mimic_scale": 6,
    "dynamic_thresholding_percentile": 0.99,
}
request, error = worker.validate_payload(payload)
assert error is None
print(json.dumps({
    "dynamic_thresholding": request["dynamic_thresholding"],
    "dynamic_thresholding_mimic_scale": request["dynamic_thresholding_mimic_scale"],
    "dynamic_thresholding_percentile": request["dynamic_thresholding_percentile"],
}))
`)

    expect(JSON.parse(output)).toEqual({
      dynamic_thresholding: true,
      dynamic_thresholding_mimic_scale: 6,
      dynamic_thresholding_percentile: 0.99
    })
  })

  it('rejects invalid dynamic thresholding fields', () => {
    const output = runWorkerSnippet(`${importWorker}
cases = [
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "dynamic_thresholding": "true"},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "dynamic_thresholding_mimic_scale": 0},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "dynamic_thresholding_mimic_scale": 21},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "dynamic_thresholding_percentile": 0.9},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "dynamic_thresholding_percentile": 1},
]
print(json.dumps([worker.validate_payload(case)[1] for case in cases]))
`)

    expect(JSON.parse(output)).toEqual([
      'dynamic_thresholding must be boolean',
      'dynamic_thresholding_mimic_scale must be between 1 and 20',
      'dynamic_thresholding_mimic_scale must be between 1 and 20',
      'dynamic_thresholding_percentile must be greater than 0.9 and less than 1',
      'dynamic_thresholding_percentile must be greater than 0.9 and less than 1'
    ])
  })

  it('accepts explicit detail enhancement fields', () => {
    const output = runWorkerSnippet(`${importWorker}
payload = {
    "prompt": "portrait",
    "output_dir": "/tmp/generated-images",
    "realism_preset": True,
    "hires_fix": True,
    "hires_scale": 2,
    "hires_steps": 15,
    "hires_denoise": 0.15,
    "bmab_postprocess": True,
    "bmab_noise_alpha": 0.05,
    "bmab_contrast": 0.9,
    "bmab_brightness": 1.1,
    "bmab_color_temperature": 15,
    "eye_refine": True,
    "eye_refine_strength": 0.14,
    "eye_refine_steps": 10,
    "detail_enhance": True,
    "detail_targets": "hand",
    "detail_strength": 0.42,
    "return_intermediate": True,
}
request, error = worker.validate_payload(payload)
assert error is None
print(json.dumps({
    "realism_preset": request["realism_preset"],
    "hires_fix": request["hires_fix"],
    "hires_scale": request["hires_scale"],
    "hires_steps": request["hires_steps"],
    "hires_denoise": request["hires_denoise"],
    "bmab_postprocess": request["bmab_postprocess"],
    "bmab_noise_alpha": request["bmab_noise_alpha"],
    "bmab_contrast": request["bmab_contrast"],
    "bmab_brightness": request["bmab_brightness"],
    "bmab_color_temperature": request["bmab_color_temperature"],
    "eye_refine": request["eye_refine"],
    "eye_refine_strength": request["eye_refine_strength"],
    "eye_refine_steps": request["eye_refine_steps"],
    "detail_enhance": request["detail_enhance"],
    "detail_targets": request["detail_targets"],
    "detail_strength": request["detail_strength"],
    "return_intermediate": request["return_intermediate"],
}))
`)

    expect(JSON.parse(output)).toEqual({
      realism_preset: true,
      hires_fix: true,
      hires_scale: 2,
      hires_steps: 15,
      hires_denoise: 0.15,
      bmab_postprocess: true,
      bmab_noise_alpha: 0.05,
      bmab_contrast: 0.9,
      bmab_brightness: 1.1,
      bmab_color_temperature: 15,
      eye_refine: true,
      eye_refine_strength: 0.14,
      eye_refine_steps: 10,
      detail_enhance: true,
      detail_targets: 'hand',
      detail_strength: 0.42,
      return_intermediate: true
    })
  })

  it('accepts explicit false boolean detail fields', () => {
    const output = runWorkerSnippet(`${importWorker}
payload = {
    "prompt": "portrait",
    "output_dir": "/tmp/generated-images",
    "detail_enhance": False,
    "return_intermediate": False,
}
request, error = worker.validate_payload(payload)
assert error is None
print(json.dumps({
    "detail_enhance": request["detail_enhance"],
    "return_intermediate": request["return_intermediate"],
}))
`)

    expect(JSON.parse(output)).toEqual({
      detail_enhance: false,
      return_intermediate: false
    })
  })

  it('rejects invalid detail fields', () => {
    const output = runWorkerSnippet(`${importWorker}
cases = [
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "detail_targets": "animal"},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "detail_strength": 0.09},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "detail_strength": 0.71},
]
print(json.dumps([worker.validate_payload(case)[1] for case in cases]))
`)

    expect(JSON.parse(output)).toEqual([
      'detail_targets must be one of auto, face, hand, person',
      'detail_strength must be between 0.1 and 0.7',
      'detail_strength must be between 0.1 and 0.7'
    ])
  })

  it('rejects invalid hires and BMAB-like fields', () => {
    const output = runWorkerSnippet(`${importWorker}
cases = [
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "hires_fix": "true"},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "bmab_postprocess": "true"},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "hires_scale": 0.9},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "hires_scale": 4.1},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "hires_steps": 0},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "hires_denoise": 0.04},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "hires_denoise": 0.51},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "bmab_noise_alpha": -0.01},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "bmab_noise_alpha": 0.51},
]
print(json.dumps([worker.validate_payload(case)[1] for case in cases]))
`)

    expect(JSON.parse(output)).toEqual([
      'hires_fix must be boolean',
      'bmab_postprocess must be boolean',
      'hires_scale must be between 1 and 4',
      'hires_scale must be between 1 and 4',
      'hires_steps must be positive',
      'hires_denoise must be between 0.05 and 0.5',
      'hires_denoise must be between 0.05 and 0.5',
      'bmab_noise_alpha must be between 0 and 0.5',
      'bmab_noise_alpha must be between 0 and 0.5'
    ])
  })

  it('rejects invalid eye refine fields', () => {
    const output = runWorkerSnippet(`${importWorker}
cases = [
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "eye_refine": "true"},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "eye_refine_strength": 0.04},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "eye_refine_strength": 0.31},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "eye_refine_steps": 0},
]
print(json.dumps([worker.validate_payload(case)[1] for case in cases]))
`)

    expect(JSON.parse(output)).toEqual([
      'eye_refine must be boolean',
      'eye_refine_strength must be between 0.05 and 0.3',
      'eye_refine_strength must be between 0.05 and 0.3',
      'eye_refine_steps must be positive'
    ])
  })

  it('rejects non-boolean detail flags', () => {
    const output = runWorkerSnippet(`${importWorker}
cases = [
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "realism_preset": "false"},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "detail_enhance": "false"},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "return_intermediate": "false"},
]
print(json.dumps([worker.validate_payload(case)[1] for case in cases]))
`)

    expect(JSON.parse(output)).toEqual([
      'realism_preset must be boolean',
      'detail_enhance must be boolean',
      'return_intermediate must be boolean'
    ])
  })

  it('rejects booleans for numeric fields', () => {
    const output = runWorkerSnippet(`${importWorker}
cases = [
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "width": True},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "seed": True},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "hires_scale": True},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "detail_strength": True},
]
print(json.dumps([worker.validate_payload(case)[1] for case in cases]))
`)

    expect(JSON.parse(output)).toEqual([
      'width must be numeric',
      'seed must be an integer',
      'hires_scale must be numeric',
      'detail_strength must be numeric'
    ])
  })

  it('rejects non-finite numeric fields', () => {
    const output = runWorkerSnippet(`${importWorker}
nan = float("nan")
cases = [
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "cfg_scale": nan},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "bmab_noise_alpha": nan},
    {"prompt": "portrait", "output_dir": "/tmp/generated-images", "detail_strength": nan},
]
print(json.dumps([worker.validate_payload(case)[1] for case in cases]))
`)

    expect(JSON.parse(output)).toEqual([
      'cfg_scale must be finite',
      'bmab_noise_alpha must be finite',
      'detail_strength must be finite'
    ])
  })
})

describe('t2i worker detail helpers', () => {
  it('expands and clamps detection boxes', () => {
    const output = runWorkerSnippet(`${importWorker}
boxes = [
    worker.expand_box((40, 50, 120, 150), 200, 300, 0.25),
    worker.expand_box((0, 0, 30, 30), 100, 100, 0.50),
]
print(json.dumps(boxes))
`)

    expect(JSON.parse(output)).toEqual([[20, 25, 140, 175], [0, 0, 45, 45]])
  })

  it('rounds crop sizes up to multiples of 64', () => {
    const output = runWorkerSnippet(`${importWorker}
print(json.dumps([
    worker.round_up_to_multiple(65, 64),
    worker.round_up_to_multiple(128, 64),
    worker.round_up_to_multiple(1, 64),
]))
`)

    expect(JSON.parse(output)).toEqual([128, 128, 64])
  })

  pillowIt('creates a soft mask with requested canvas size', () => {
    const output = runWorkerSnippet(`${importWorker}
mask = worker.create_soft_mask((10, 20, 50, 80), (100, 120), 8)
print(json.dumps({
    "mode": mask.mode,
    "size": list(mask.size),
    "bbox": list(mask.getbbox()),
}))
`)

    const parsed = JSON.parse(output) as { mode: string; size: number[]; bbox: number[] }
    expect(parsed.mode).toBe('L')
    expect(parsed.size).toEqual([100, 120])
    expect(parsed.bbox[0]).toBeLessThanOrEqual(10)
    expect(parsed.bbox[1]).toBeLessThanOrEqual(20)
    expect(parsed.bbox[2]).toBeGreaterThanOrEqual(50)
    expect(parsed.bbox[3]).toBeGreaterThanOrEqual(80)
  })

  pillowIt('fills half-open boxes before blur', () => {
    const output = runWorkerSnippet(`${importWorker}
mask = worker.create_soft_mask((1, 1, 3, 3), (5, 5), 0)
print(json.dumps({
    "inside": mask.getpixel((2, 2)),
    "right_bottom": mask.getpixel((3, 3)),
}))
`)

    expect(JSON.parse(output)).toEqual({
      inside: 255,
      right_bottom: 0
    })
  })

  it('resolves face and hand detector model paths for auto targets', () => {
    const output = runWorkerSnippet(`${importWorker}
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory() as tmpdir:
    face_model = Path(tmpdir) / "face.pt"
    hand_model = Path(tmpdir) / "hand.pt"
    person_model = Path(tmpdir) / "person.pt"
    face_model.write_text("face")
    hand_model.write_text("hand")
    person_model.write_text("person")
    paths = worker.resolve_detector_model_paths(
        "auto",
        {
            "T2I_FACE_DETECTOR_MODEL": str(face_model),
            "T2I_HAND_DETECTOR_MODEL": str(hand_model),
            "T2I_PERSON_DETECTOR_MODEL": str(person_model),
        },
    )
print(json.dumps(paths, sort_keys=True))
`)

    const parsed = JSON.parse(output) as { face: string, hand: string, person?: string }
    expect(parsed.face).toMatch(/face\.pt$/)
    expect(parsed.hand).toMatch(/hand\.pt$/)
    expect(parsed.person).toBeUndefined()
  })

  it('applies realism preset prompts to improve photo realism', () => {
    const output = runWorkerSnippet(`${importWorker}
request = {
    "prompt": "portrait photo",
    "negative_prompt": "bad hands",
    "realism_preset": True,
}
worker.apply_realism_preset(request)
print(json.dumps({
    "prompt": request["prompt"],
    "negative_prompt": request["negative_prompt"],
}))
`)

    const parsed = JSON.parse(output) as { prompt: string, negative_prompt: string }
    expect(parsed.prompt).toContain('portrait photo')
    expect(parsed.prompt).toContain('realistic candid photograph')
    expect(parsed.negative_prompt).toContain('bad hands')
    expect(parsed.negative_prompt).toContain('cgi')
    expect(parsed.negative_prompt).toContain('plastic skin')
    expect(parsed.negative_prompt).toContain('over-smoothed skin')
  })

  torchIt('clips extreme latent values with dynamic thresholding helper', () => {
    const output = runWorkerSnippet(`${importWorker}
import torch
latents = torch.tensor([[[[0.0, 1.0], [20.0, -200.0]]]], dtype=torch.float16)
limited = worker.dynamic_threshold_latents(
    torch,
    latents,
    guidance_scale=12.0,
    mimic_scale=7.0,
    percentile=0.95,
)
threshold = torch.quantile(latents.detach().float().reshape(latents.shape[0], -1).abs(), 0.95, dim=1)
threshold = torch.maximum(threshold, torch.ones_like(threshold))
threshold = threshold.reshape((latents.shape[0],) + (1,) * (latents.ndim - 1)).to(device=limited.device, dtype=limited.dtype)
print(json.dumps({
    "reduced": bool(limited.abs().max().item() < latents.abs().max().item()),
    "capped": bool(limited.abs().le(threshold).all().item()),
    "dtype": str(limited.dtype),
    "device": str(limited.device),
    "shape": list(limited.shape),
    "changed": bool(not torch.equal(latents, limited)),
}))
`)

    expect(JSON.parse(output)).toEqual({
      reduced: true,
      capped: true,
      dtype: 'torch.float16',
      device: 'cpu',
      shape: [1, 1, 2, 2],
      changed: true
    })
  })

  pillowAndTorchIt('wires dynamic thresholding callback into supported diffusers pipeline', () => {
    const output = runWorkerSnippet(`${importWorker}
import json
import tempfile
import torch
from types import SimpleNamespace
from PIL import Image

recorded = {}

class FakeGenerator:
    def __init__(self, device):
        self.device = device
        self.seed = None

    def manual_seed(self, seed):
        self.seed = seed
        return self

class FakeTorch:
    Generator = FakeGenerator
    quantile = staticmethod(torch.quantile)
    maximum = staticmethod(torch.maximum)
    ones_like = staticmethod(torch.ones_like)

class FakePipe:
    device = "cpu"

    def __call__(
        self,
        *,
        callback_on_step_end=None,
        callback_on_step_end_tensor_inputs=None,
        **kwargs,
    ):
        latents = torch.tensor([[[[0.0, 1.0], [20.0, -200.0]]]], dtype=torch.float32)
        callback_result = callback_on_step_end(self, 0, "timestep", {"latents": latents})
        recorded.update({
            "has_callback": callback_on_step_end is not None,
            "tensor_inputs": callback_on_step_end_tensor_inputs,
            "callback_result_has_latents": "latents" in callback_result,
            "callback_input_dtype": str(latents.dtype),
            "callback_output_dtype": str(callback_result["latents"].dtype),
            "callback_changed_latents": bool(not torch.equal(latents, callback_result["latents"])),
        })
        return SimpleNamespace(images=[Image.new("RGB", (kwargs["width"], kwargs["height"]), "white")])

with tempfile.TemporaryDirectory() as output_dir:
    request, error = worker.validate_payload({
        "prompt": "portrait",
        "negative_prompt": "low quality",
        "output_dir": output_dir,
        "width": 16,
        "height": 16,
        "steps": 2,
        "cfg_scale": 12,
        "seed": 123,
        "dynamic_thresholding": True,
    })
    assert error is None
    images = worker.generate_images(worker.WorkerState("model.safetensors", FakePipe(), FakeTorch()), request)

print(json.dumps({
    "recorded": recorded,
    "metadata": {
        "dynamic_thresholding": images[0]["dynamic_thresholding"],
        "dynamic_thresholding_mimic_scale": images[0]["dynamic_thresholding_mimic_scale"],
        "dynamic_thresholding_percentile": images[0]["dynamic_thresholding_percentile"],
        "seed": images[0]["seed"],
        "width": images[0]["width"],
        "height": images[0]["height"],
    },
}))
`)

    expect(JSON.parse(output)).toEqual({
      recorded: {
        has_callback: true,
        tensor_inputs: ['latents'],
        callback_result_has_latents: true,
        callback_input_dtype: 'torch.float32',
        callback_output_dtype: 'torch.float32',
        callback_changed_latents: true
      },
      metadata: {
        dynamic_thresholding: true,
        dynamic_thresholding_mimic_scale: 7,
        dynamic_thresholding_percentile: 0.995,
        seed: 123,
        width: 16,
        height: 16
      }
    })
  })

  pillowAndTorchIt('rejects dynamic thresholding when the pipeline lacks step-end callback support', () => {
    const output = runWorkerSnippet(`${importWorker}
import tempfile
from types import SimpleNamespace

class FakeGenerator:
    def __init__(self, device):
        self.device = device

    def manual_seed(self, seed):
        return self

class FakeTorch:
    Generator = FakeGenerator

class FakePipe:
    device = "cpu"

    def __call__(self, **kwargs):
        raise AssertionError("pipeline should not be called")

with tempfile.TemporaryDirectory() as output_dir:
    request, error = worker.validate_payload({
        "prompt": "portrait",
        "output_dir": output_dir,
        "seed": 123,
        "dynamic_thresholding": True,
    })
    assert error is None
    try:
        worker.generate_images(worker.WorkerState("model.safetensors", FakePipe(), FakeTorch()), request)
    except RuntimeError as exc:
        print(str(exc))
`)

    expect(output).toBe('dynamic_thresholding requires diffusers callback_on_step_end support')
  })

  pillowAndTorchIt('keeps dynamic thresholding callback arguments during clip_skip fallback', () => {
    const output = runWorkerSnippet(`${importWorker}
import json
import tempfile
import torch
from types import SimpleNamespace
from PIL import Image

calls = []

class FakeGenerator:
    def __init__(self, device):
        self.device = device

    def manual_seed(self, seed):
        return self

class FakeTorch:
    Generator = FakeGenerator
    quantile = staticmethod(torch.quantile)
    maximum = staticmethod(torch.maximum)
    ones_like = staticmethod(torch.ones_like)

class FakePipe:
    device = "cpu"

    def __call__(
        self,
        *,
        callback_on_step_end=None,
        callback_on_step_end_tensor_inputs=None,
        **kwargs,
    ):
        calls.append({
            "has_clip_skip": "clip_skip" in kwargs,
            "has_callback": callback_on_step_end is not None,
            "tensor_inputs": callback_on_step_end_tensor_inputs,
        })
        if "clip_skip" in kwargs:
            raise TypeError("got an unexpected keyword argument 'clip_skip'")

        latents = torch.tensor([[[[0.0, 1.0], [20.0, -200.0]]]], dtype=torch.float32)
        callback_result = callback_on_step_end(self, 0, "timestep", {"latents": latents})
        calls[-1]["callback_result_has_latents"] = "latents" in callback_result
        return SimpleNamespace(images=[Image.new("RGB", (kwargs["width"], kwargs["height"]), "white")])

with tempfile.TemporaryDirectory() as output_dir:
    request, error = worker.validate_payload({
        "prompt": "portrait",
        "output_dir": output_dir,
        "width": 16,
        "height": 16,
        "steps": 2,
        "cfg_scale": 12,
        "seed": 123,
        "dynamic_thresholding": True,
    })
    assert error is None
    worker.generate_images(worker.WorkerState("model.safetensors", FakePipe(), FakeTorch()), request)

print(json.dumps(calls))
`)

    expect(JSON.parse(output)).toEqual([
      {
        has_clip_skip: true,
        has_callback: true,
        tensor_inputs: ['latents']
      },
      {
        has_clip_skip: false,
        has_callback: true,
        tensor_inputs: ['latents'],
        callback_result_has_latents: true
      }
    ])
  })

  pillowAndTorchIt('does not retry when clip_skip appears in an internal TypeError', () => {
    const output = runWorkerSnippet(`${importWorker}
import json
import tempfile
import torch
from types import SimpleNamespace
from PIL import Image

calls = 0

class FakeGenerator:
    def __init__(self, device):
        self.device = device

    def manual_seed(self, seed):
        return self

class FakeTorch:
    Generator = FakeGenerator
    quantile = staticmethod(torch.quantile)
    maximum = staticmethod(torch.maximum)
    ones_like = staticmethod(torch.ones_like)

class FakePipe:
    device = "cpu"

    def __call__(
        self,
        *,
        callback_on_step_end=None,
        callback_on_step_end_tensor_inputs=None,
        **kwargs,
    ):
        global calls
        calls += 1
        if calls == 1:
            raise TypeError("internal callback failed while clip_skip=2 was active")
        return SimpleNamespace(images=[Image.new("RGB", (kwargs["width"], kwargs["height"]), "white")])

with tempfile.TemporaryDirectory() as output_dir:
    request, error = worker.validate_payload({
        "prompt": "portrait",
        "output_dir": output_dir,
        "width": 16,
        "height": 16,
        "steps": 2,
        "cfg_scale": 12,
        "seed": 123,
        "dynamic_thresholding": True,
    })
    assert error is None
    try:
        worker.generate_images(worker.WorkerState("model.safetensors", FakePipe(), FakeTorch()), request)
        raised = None
    except TypeError as exc:
        raised = str(exc)

print(json.dumps({"calls": calls, "raised": raised}))
`)

    expect(JSON.parse(output)).toEqual({
      calls: 1,
      raised: 'internal callback failed while clip_skip=2 was active'
    })
  })

  pillowIt('applies hires fix with expected img2img arguments using fake pipeline and torch', () => {
    const output = runWorkerSnippet(`${importWorker}
import json
from types import SimpleNamespace
from PIL import Image

recorded = {}

class FakePipe:
    def __call__(self, **kwargs):
        recorded.update({
            "prompt": kwargs["prompt"],
            "negative_prompt": kwargs["negative_prompt"],
            "strength": kwargs["strength"],
            "num_inference_steps": kwargs["num_inference_steps"],
            "guidance_scale": kwargs["guidance_scale"],
            "clip_skip": kwargs["clip_skip"],
            "image_size": list(kwargs["image"].size),
            "generator_seed": kwargs["generator"].seed,
            "generator_device": kwargs["generator"].device,
        })
        return SimpleNamespace(images=[Image.new("RGB", kwargs["image"].size, "gray")])

class FakeGenerator:
    def __init__(self, device):
        self.device = device
        self.seed = None

    def manual_seed(self, seed):
        self.seed = seed
        return self

class FakeTorch:
    Generator = FakeGenerator

state = SimpleNamespace(
    pipe=SimpleNamespace(device="cpu"),
    torch=FakeTorch(),
)
worker.get_img2img_pipe = lambda state: FakePipe()

request = {
    "prompt": "1girl",
    "negative_prompt": "low quality",
    "hires_scale": 2,
    "hires_steps": 15,
    "hires_denoise": 0.15,
    "cfg_scale": 7,
}
result = worker.apply_hires_fix(state, Image.new("RGB", (128, 192), "white"), request, 4216575493)

print(json.dumps({
    "result_size": list(result.size),
    "recorded": recorded,
}))
`)

    expect(JSON.parse(output)).toEqual({
      result_size: [256, 384],
      recorded: {
        prompt: '1girl',
        negative_prompt: 'low quality',
        strength: 0.15,
        num_inference_steps: 15,
        guidance_scale: 7,
        clip_skip: 2,
        image_size: [256, 384],
        generator_seed: 4216595493,
        generator_device: 'cpu'
      }
    })
  })

  pillowIt('falls back to tiled hires fix when full-size img2img exceeds memory', () => {
    const output = runWorkerSnippet(`${importWorker}
import json
from types import SimpleNamespace
from PIL import Image

calls = []

class FakePipe:
    def __call__(self, **kwargs):
        size = list(kwargs["image"].size)
        calls.append(size)
        if size == [1024, 1536]:
            raise RuntimeError("Invalid buffer size: 18.00 GiB")
        return SimpleNamespace(images=[Image.new("RGB", kwargs["image"].size, "gray")])

class FakeGenerator:
    def __init__(self, device):
        self.device = device

    def manual_seed(self, seed):
        return self

class FakeTorch:
    Generator = FakeGenerator

state = SimpleNamespace(
    pipe=SimpleNamespace(device="cpu"),
    torch=FakeTorch(),
)
worker.get_img2img_pipe = lambda state: FakePipe()

request = {
    "prompt": "1girl",
    "negative_prompt": "low quality",
    "hires_scale": 2,
    "hires_steps": 15,
    "hires_denoise": 0.15,
    "cfg_scale": 7,
}
result = worker.apply_hires_fix(state, Image.new("RGB", (512, 768), "white"), request, 4216575493)

print(json.dumps({
    "result_size": list(result.size),
    "calls": calls,
    "max_tile_width": max(size[0] for size in calls[1:]),
    "max_tile_height": max(size[1] for size in calls[1:]),
}))
`)

    const parsed = JSON.parse(output) as { result_size: number[], calls: number[][], max_tile_width: number, max_tile_height: number }
    expect(parsed.result_size).toEqual([1024, 1536])
    expect(parsed.calls[0]).toEqual([1024, 1536])
    expect(parsed.calls.length).toBeGreaterThan(1)
    expect(parsed.max_tile_width).toBeLessThanOrEqual(512)
    expect(parsed.max_tile_height).toBeLessThanOrEqual(512)
  })

  pillowIt('applies BMAB-like postprocess without changing image size', () => {
    const output = runWorkerSnippet(`${importWorker}
from PIL import Image

request = {
    "bmab_noise_alpha": 0,
    "bmab_contrast": 0.9,
    "bmab_brightness": 1.1,
    "bmab_color_temperature": 15,
}
image = Image.new("RGB", (4, 4), (100, 100, 100))
result = worker.apply_bmab_postprocess(image, request, 123)
print(json.dumps({
    "size": list(result.size),
    "mode": result.mode,
    "pixel": list(result.getpixel((0, 0))),
}))
`)

    const parsed = JSON.parse(output) as { size: number[], mode: string, pixel: number[] }
    expect(parsed.size).toEqual([4, 4])
    expect(parsed.mode).toBe('RGB')
    expect(parsed.pixel).not.toEqual([100, 100, 100])
    expect(parsed.pixel[0]).toBeGreaterThan(parsed.pixel[2])
  })

  pillowIt('runs an extra low-strength eye refine pass for detected faces', () => {
    const output = runWorkerSnippet(`${importWorker}
import json
from types import SimpleNamespace
from PIL import Image

calls = []

class FakePipe:
    def __call__(self, **kwargs):
        calls.append({
            "prompt": kwargs["prompt"],
            "strength": kwargs["strength"],
            "steps": kwargs["num_inference_steps"],
            "image_size": list(kwargs["image"].size),
        })
        return SimpleNamespace(images=[Image.new("RGB", kwargs["image"].size, "gray")])

class FakeGenerator:
    def __init__(self, device):
        self.device = device

    def manual_seed(self, seed):
        return self

class FakeTorch:
    Generator = FakeGenerator

state = SimpleNamespace(
    pipe=SimpleNamespace(device="cpu"),
    torch=FakeTorch(),
    img2img_pipe=FakePipe(),
)

worker.detect_regions = lambda state, image, request: [{
    "target": "face",
    "box": (20, 10, 180, 210),
    "detected_box": (50, 30, 150, 170),
}]

request = {
    "prompt": "portrait",
    "negative_prompt": "low quality",
    "detail_strength": 0.2,
    "eye_refine": True,
    "eye_refine_strength": 0.12,
    "eye_refine_steps": 8,
    "steps": 20,
    "cfg_scale": 7,
}
image, metadata = worker.enhance_details(state, Image.new("RGB", (220, 240), "white"), request, 123)

print(json.dumps({
    "image_size": list(image.size),
    "metadata": metadata,
    "calls": calls,
}))
`)

    const parsed = JSON.parse(output) as {
      image_size: number[]
      metadata: { detail_enhanced: boolean, detail_regions: number, detail_targets: string[], eye_refined: boolean, eye_regions: number }
      calls: Array<{ prompt: string, strength: number, steps: number, image_size: number[] }>
    }
    expect(parsed.image_size).toEqual([220, 240])
    expect(parsed.metadata).toEqual({
      detail_enhanced: true,
      detail_regions: 1,
      detail_targets: ['face'],
      eye_refined: true,
      eye_regions: 1
    })
    expect(parsed.calls).toHaveLength(2)
    expect(parsed.calls[0]).toEqual(expect.objectContaining({
      strength: 0.2,
      steps: 20,
      image_size: [192, 256]
    }))
    expect(parsed.calls[1]).toEqual(expect.objectContaining({
      strength: 0.12,
      steps: 9,
      image_size: [128, 128]
    }))
    expect(parsed.calls[1].prompt).toContain('realistic eyes')
  })

  it('ignores missing auto detector paths when another target exists', () => {
    const output = runWorkerSnippet(`${importWorker}
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory() as tmpdir:
    face_model = Path(tmpdir) / "face.pt"
    face_model.write_text("face")
    paths = worker.resolve_detector_model_paths(
        "auto",
        {
            "T2I_FACE_DETECTOR_MODEL": str(face_model),
            "T2I_HAND_DETECTOR_MODEL": str(Path(tmpdir) / "missing-hand.pt"),
            "T2I_PERSON_DETECTOR_MODEL": "",
        },
    )
print(json.dumps({"keys": sorted(paths.keys()), "face": paths["face"]}))
`)

    const parsed = JSON.parse(output) as { keys: string[], face: string }
    expect(parsed.keys).toEqual(['face'])
    expect(parsed.face).toMatch(/face\.pt$/)
  })

  it('requires at least one existing detector path for auto targets', () => {
    const output = runWorkerSnippet(`${importWorker}
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory() as tmpdir:
    try:
        worker.resolve_detector_model_paths(
            "auto",
            {
                "T2I_FACE_DETECTOR_MODEL": str(Path(tmpdir) / "missing-face.pt"),
                "T2I_HAND_DETECTOR_MODEL": str(Path(tmpdir) / "missing-hand.pt"),
            },
        )
    except RuntimeError as exc:
        print(str(exc))
`)

    expect(output).toBe(
      'No detector models configured for automatic detail enhancement. Set T2I_FACE_DETECTOR_MODEL or T2I_HAND_DETECTOR_MODEL.'
    )
  })

  it('rejects missing explicit detector model paths', () => {
    const output = runWorkerSnippet(`${importWorker}
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory() as tmpdir:
    missing_model = Path(tmpdir) / "missing-hand.pt"
    try:
        worker.resolve_detector_model_paths(
            "hand",
            {"T2I_HAND_DETECTOR_MODEL": str(missing_model)},
        )
    except RuntimeError as exc:
        print(json.dumps({
            "actual": str(exc),
            "expected": f"Detector model for detail target hand does not exist: {missing_model}",
        }))
`)

    const parsed = JSON.parse(output) as { actual: string, expected: string }
    expect(parsed.actual).toBe(parsed.expected)
  })

  pillowIt('detects, expands, sorts, and caps regions from fake YOLO boxes', () => {
    const output = runWorkerSnippet(`${importWorker}
from PIL import Image

class FakeXyxy:
    def tolist(self):
        return [
            [10, 10, 10, 12],
            [30, 40, 20, 50],
            [20, 20, 30, 30],
            [20, 20, 35, 35],
            [20, 20, 40, 40],
            [20, 20, 45, 45],
            [20, 20, 50, 50],
            [20, 20, 60, 60],
            [20, 20, 70, 70],
            [20, 20, 80, 80],
            [20, 20, 90, 90],
            [50, 50, 150, 150],
        ]

class FakeBoxes:
    xyxy = FakeXyxy()

class FakeResult:
    boxes = FakeBoxes()

class FakeDetector:
    def predict(self, image, verbose, conf, device):
        assert verbose is False
        assert conf == 0.25
        assert device == "cpu"
        return [FakeResult()]

worker.resolve_detector_model_paths = lambda detail_targets: {"face": "/fake/face.pt"}
worker.get_detector = lambda state, target, model_path: FakeDetector()

regions = worker.detect_regions(None, Image.new("RGB", (200, 200), "white"), {"detail_targets": "auto"})
print(json.dumps(regions))
`)

    expect(JSON.parse(output)).toEqual([
      { target: 'face', box: [15, 15, 185, 185], detected_box: [50, 50, 150, 150] },
      { target: 'face', box: [0, 0, 114, 114], detected_box: [20, 20, 90, 90] },
      { target: 'face', box: [0, 0, 101, 101], detected_box: [20, 20, 80, 80] },
      { target: 'face', box: [3, 3, 87, 87], detected_box: [20, 20, 70, 70] },
      { target: 'face', box: [6, 6, 74, 74], detected_box: [20, 20, 60, 60] },
      { target: 'face', box: [10, 10, 60, 60], detected_box: [20, 20, 50, 50] },
      { target: 'face', box: [12, 12, 53, 53], detected_box: [20, 20, 45, 45] },
      { target: 'face', box: [13, 13, 47, 47], detected_box: [20, 20, 40, 40] }
    ])
  })

  pillowIt('refines a crop with expected img2img arguments using fake pipeline and torch', () => {
    const output = runWorkerSnippet(`${importWorker}
import json
from types import SimpleNamespace
from PIL import Image

recorded = {}

class FakePipe:
    def __call__(self, **kwargs):
        recorded.update({
            "prompt": kwargs["prompt"],
            "negative_prompt": kwargs["negative_prompt"],
            "strength": kwargs["strength"],
            "num_inference_steps": kwargs["num_inference_steps"],
            "guidance_scale": kwargs["guidance_scale"],
            "clip_skip": kwargs["clip_skip"],
            "image_size": list(kwargs["image"].size),
            "generator_seed": kwargs["generator"].seed,
            "generator_device": kwargs["generator"].device,
        })
        return SimpleNamespace(images=[Image.new("RGB", kwargs["image"].size, "black")])

class FakeGenerator:
    def __init__(self, device):
        self.device = device
        self.seed = None

    def manual_seed(self, seed):
        self.seed = seed
        return self

class FakeTorch:
    Generator = FakeGenerator

state = SimpleNamespace(
    pipe=SimpleNamespace(device="cpu"),
    torch=FakeTorch(),
)
worker.get_img2img_pipe = lambda state: FakePipe()

image = Image.new("RGB", (100, 100), "white")
request = {
    "prompt": "portrait",
    "negative_prompt": "low quality",
    "steps": 50,
    "cfg_scale": 6.5,
    "detail_strength": 0.42,
}
result = worker.refine_region(state, image, {"target": "face", "box": (10, 10, 60, 75)}, request, 123, 2)

print(json.dumps({
    "result_size": list(result.size),
    "recorded": recorded,
}))
`)

    expect(JSON.parse(output)).toEqual({
      result_size: [100, 100],
      recorded: {
        prompt: 'natural face, consistent gaze direction, natural eyelids, realistic eyes, natural skin texture, portrait',
        negative_prompt: 'low quality, cross-eyed, misaligned eyes, uneven pupils, distorted iris, unnatural catchlights, over-sharpened eyes',
        strength: 0.42,
        num_inference_steps: 20,
        guidance_scale: 6.5,
        clip_skip: 2,
        image_size: [64, 128],
        generator_seed: 10125,
        generator_device: 'cpu'
      }
    })
  })

  it('requires an explicit detector path for explicit targets', () => {
    const output = runWorkerSnippet(`${importWorker}
try:
    worker.resolve_detector_model_paths("hand", {})
except RuntimeError as exc:
    print(str(exc))
`)

    expect(output).toContain('No detector model configured for detail target hand')
  })

  it('rejects invalid detector helper targets', () => {
    const output = runWorkerSnippet(`${importWorker}
try:
    worker.resolve_detector_model_paths("animal", {})
except RuntimeError as exc:
    print(str(exc))
`)

    expect(output).toBe('detail_targets must be one of auto, face, hand, person')
  })

  pillowIt('returns detail enhancement metadata without loading models in helper paths', () => {
    const output = runWorkerSnippet(`${importWorker}
from PIL import Image

image = Image.new("RGB", (8, 8), "white")
request = {
    "prompt": "portrait",
    "negative_prompt": "",
    "steps": 12,
    "cfg_scale": 7,
    "detail_strength": 0.35,
}

worker.detect_regions = lambda state, image, request: []
no_region_image, no_region_metadata = worker.enhance_details(None, image, request, 123)

calls = []
def fake_refine_region(state, image, region, request, seed, index):
    calls.append({"target": region["target"], "index": index, "seed": seed})
    return image.copy()

worker.detect_regions = lambda state, image, request: [
    {"target": "face", "box": (0, 0, 4, 4)},
    {"target": "hand", "box": (4, 4, 8, 8)},
    {"target": "face", "box": (1, 1, 5, 5)},
]
worker.refine_region = fake_refine_region
enhanced_image, enhanced_metadata = worker.enhance_details(None, image, request, 456)

print(json.dumps({
    "no_region_same": no_region_image is image,
    "no_region_metadata": no_region_metadata,
    "enhanced_size": list(enhanced_image.size),
    "enhanced_metadata": enhanced_metadata,
    "calls": calls,
}))
`)

    expect(JSON.parse(output)).toEqual({
      no_region_same: true,
      no_region_metadata: {
        detail_enhanced: false,
        detail_regions: 0,
        detail_targets: []
      },
      enhanced_size: [8, 8],
      enhanced_metadata: {
        detail_enhanced: true,
        detail_regions: 3,
        detail_targets: ['face', 'hand']
      },
      calls: [
        { target: 'face', index: 0, seed: 456 },
        { target: 'hand', index: 1, seed: 456 },
        { target: 'face', index: 2, seed: 456 }
      ]
    })
  })
})
