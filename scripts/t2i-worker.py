#!/usr/bin/env python3
"""Persistent local SD1.5 text-to-image worker."""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

DESCRIPTION = "Local SD1.5 text-to-image worker"
DEFAULT_MODEL_PATH = "./T2I/majicmixRealistic_v7.safetensors"
DETAIL_TARGETS = {"auto", "face", "hand", "person"}
DEFAULT_DETAIL_STRENGTH = 0.35
DEFAULT_REALISM_DETAIL_STRENGTH = 0.2
DEFAULT_HIRES_SCALE = 2.0
DEFAULT_HIRES_STEPS = 15
DEFAULT_HIRES_DENOISE = 0.15
DEFAULT_BMAB_NOISE_ALPHA = 0.05
DEFAULT_BMAB_CONTRAST = 0.9
DEFAULT_BMAB_BRIGHTNESS = 1.1
DEFAULT_BMAB_COLOR_TEMPERATURE = 15.0
DEFAULT_EYE_REFINE_STRENGTH = 0.12
DEFAULT_EYE_REFINE_STEPS = 12
HIRES_TILE_SIZE = 512
AUTO_DETAIL_TARGETS = ("face", "hand")
DETECTOR_ENV_BY_TARGET = {
    "face": "T2I_FACE_DETECTOR_MODEL",
    "hand": "T2I_HAND_DETECTOR_MODEL",
    "person": "T2I_PERSON_DETECTOR_MODEL",
}
DETAIL_PROMPT_PREFIX = {
    "face": "natural face, consistent gaze direction, natural eyelids, realistic eyes, natural skin texture",
    "hand": "detailed hands, natural fingers, coherent anatomy",
    "person": "anatomically coherent person, detailed features",
}
DETAIL_NEGATIVE_PROMPT = {
    "face": "cross-eyed, misaligned eyes, uneven pupils, distorted iris, unnatural catchlights, over-sharpened eyes",
}
EYE_REFINE_PROMPT = (
    "realistic eyes, aligned pupils, natural iris details, natural eyelids, "
    "consistent catchlights, sharp but natural eye focus"
)
EYE_REFINE_NEGATIVE_PROMPT = (
    "cross-eyed, misaligned pupils, uneven pupils, distorted iris, warped eyelids, "
    "extra eyelids, duplicated eyes, unnatural catchlights, over-sharpened eyes"
)
REALISM_PROMPT_SUFFIX = (
    "realistic candid photograph, natural skin texture, visible skin pores, "
    "subtle skin imperfections, natural ambient light, camera grain"
)
REALISM_NEGATIVE_PROMPT = (
    "cgi, 3d render, doll, plastic skin, porcelain skin, airbrushed, "
    "over-smoothed skin, waxy skin, cartoon, anime, illustration"
)
DEPENDENCY_ERROR = (
    "Missing T2I dependencies. Install them with: "
    "python3 -m pip install -r requirements-t2i.txt"
)


class WorkerState:
    def __init__(self, model_path: str, pipe: Any, torch_module: Any):
        self.model_path = model_path
        self.model_name = Path(model_path).stem
        self.pipe = pipe
        self.torch = torch_module
        self.generation_lock = threading.Lock()
        self.img2img_pipe = None
        self.detectors: dict[str, Any] = {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=DESCRIPTION)
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "7861")))
    parser.add_argument(
        "--model-path",
        default=os.environ.get("T2I_MODEL_PATH", DEFAULT_MODEL_PATH),
        help=f"Path to a single-file SD1.5 checkpoint. Default: {DEFAULT_MODEL_PATH}",
    )
    return parser.parse_args()


def load_pipeline(model_path: str) -> tuple[Any, Any]:
    try:
        import torch
        from diffusers import EulerAncestralDiscreteScheduler, StableDiffusionPipeline
    except ImportError as exc:
        raise RuntimeError(DEPENDENCY_ERROR) from exc

    if torch.cuda.is_available():
        device = "cuda"
        dtype = torch.float16
    elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        device = "mps"
        dtype = torch.float16
    else:
        device = "cpu"
        dtype = torch.float32

    pipe = StableDiffusionPipeline.from_single_file(
        model_path,
        torch_dtype=dtype,
        safety_checker=None,
        requires_safety_checker=False,
    )
    pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
    pipe.to(device)
    return pipe, torch


def json_response(handler: BaseHTTPRequestHandler, status: HTTPStatus, body: dict[str, Any]) -> None:
    payload = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json")
    handler.send_header("content-length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def read_json_body(handler: BaseHTTPRequestHandler) -> tuple[Any | None, str | None]:
    try:
        content_length = int(handler.headers.get("content-length", "0"))
    except ValueError:
        return None, "Invalid content length."

    try:
        body = handler.rfile.read(content_length).decode("utf-8")
        return json.loads(body), None
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, "Invalid JSON body."


def validate_payload(payload: Any) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(payload, dict):
        return None, "request body must be a JSON object"

    prompt = payload.get("prompt")
    output_dir = payload.get("output_dir")
    if not isinstance(prompt, str) or not prompt.strip():
        return None, "prompt is required"
    if not isinstance(output_dir, str) or not os.path.isabs(output_dir):
        return None, "output_dir must be an absolute path"

    try:
        width = int(payload.get("width", 512))
        height = int(payload.get("height", 768))
        steps = int(payload.get("steps", 30))
        cfg_scale = float(payload.get("cfg_scale", 7))
        count = int(payload.get("count", 1))
    except (TypeError, ValueError):
        return None, "width, height, steps, cfg_scale, and count must be numeric"

    seed = payload.get("seed")
    if seed is not None:
        try:
            seed = int(seed)
        except (TypeError, ValueError):
            return None, "seed must be an integer"

    realism_preset = payload.get("realism_preset", False)
    if not isinstance(realism_preset, bool):
        return None, "realism_preset must be boolean"
    if realism_preset and "cfg_scale" not in payload:
        cfg_scale = 6.0

    hires_fix = payload.get("hires_fix", False)
    if not isinstance(hires_fix, bool):
        return None, "hires_fix must be boolean"

    bmab_postprocess = payload.get("bmab_postprocess", False)
    if not isinstance(bmab_postprocess, bool):
        return None, "bmab_postprocess must be boolean"

    eye_refine = payload.get("eye_refine", False)
    if not isinstance(eye_refine, bool):
        return None, "eye_refine must be boolean"

    try:
        hires_scale = float(payload.get("hires_scale", DEFAULT_HIRES_SCALE))
        hires_steps = int(payload.get("hires_steps", DEFAULT_HIRES_STEPS))
        hires_denoise = float(payload.get("hires_denoise", DEFAULT_HIRES_DENOISE))
        bmab_noise_alpha = float(payload.get("bmab_noise_alpha", DEFAULT_BMAB_NOISE_ALPHA))
        bmab_contrast = float(payload.get("bmab_contrast", DEFAULT_BMAB_CONTRAST))
        bmab_brightness = float(payload.get("bmab_brightness", DEFAULT_BMAB_BRIGHTNESS))
        bmab_color_temperature = float(payload.get("bmab_color_temperature", DEFAULT_BMAB_COLOR_TEMPERATURE))
        eye_refine_strength = float(payload.get("eye_refine_strength", DEFAULT_EYE_REFINE_STRENGTH))
        eye_refine_steps = int(payload.get("eye_refine_steps", DEFAULT_EYE_REFINE_STEPS))
    except (TypeError, ValueError):
        return None, "hires, BMAB-like, and eye refine fields must be numeric"

    if hires_scale < 1 or hires_scale > 4:
        return None, "hires_scale must be between 1 and 4"
    if hires_steps <= 0:
        return None, "hires_steps must be positive"
    if hires_denoise < 0.05 or hires_denoise > 0.5:
        return None, "hires_denoise must be between 0.05 and 0.5"
    if bmab_noise_alpha < 0 or bmab_noise_alpha > 0.5:
        return None, "bmab_noise_alpha must be between 0 and 0.5"
    if bmab_contrast <= 0 or bmab_brightness <= 0:
        return None, "bmab_contrast and bmab_brightness must be positive"
    if bmab_color_temperature < -100 or bmab_color_temperature > 100:
        return None, "bmab_color_temperature must be between -100 and 100"
    if eye_refine_strength < 0.05 or eye_refine_strength > 0.3:
        return None, "eye_refine_strength must be between 0.05 and 0.3"
    if eye_refine_steps <= 0:
        return None, "eye_refine_steps must be positive"

    detail_enhance = payload.get("detail_enhance", False)
    if not isinstance(detail_enhance, bool):
        return None, "detail_enhance must be boolean"

    detail_targets = payload.get("detail_targets", "auto")
    return_intermediate = payload.get("return_intermediate", False)
    if not isinstance(return_intermediate, bool):
        return None, "return_intermediate must be boolean"

    if not isinstance(detail_targets, str) or detail_targets not in DETAIL_TARGETS:
        return None, "detail_targets must be one of auto, face, hand, person"

    try:
        detail_strength = float(payload.get(
            "detail_strength",
            DEFAULT_REALISM_DETAIL_STRENGTH if realism_preset else DEFAULT_DETAIL_STRENGTH,
        ))
    except (TypeError, ValueError):
        return None, "detail_strength must be numeric"

    if detail_strength < 0.1 or detail_strength > 0.7:
        return None, "detail_strength must be between 0.1 and 0.7"

    if width <= 0 or height <= 0 or steps <= 0 or count <= 0:
        return None, "width, height, steps, and count must be positive"

    return {
        "prompt": prompt.strip(),
        "negative_prompt": payload.get("negative_prompt", "") or "",
        "output_dir": output_dir,
        "width": width,
        "height": height,
        "steps": steps,
        "cfg_scale": cfg_scale,
        "seed": seed,
        "count": count,
        "realism_preset": realism_preset,
        "hires_fix": hires_fix,
        "hires_scale": hires_scale,
        "hires_steps": hires_steps,
        "hires_denoise": hires_denoise,
        "bmab_postprocess": bmab_postprocess,
        "bmab_noise_alpha": bmab_noise_alpha,
        "bmab_contrast": bmab_contrast,
        "bmab_brightness": bmab_brightness,
        "bmab_color_temperature": bmab_color_temperature,
        "eye_refine": eye_refine,
        "eye_refine_strength": eye_refine_strength,
        "eye_refine_steps": eye_refine_steps,
        "detail_enhance": detail_enhance,
        "detail_targets": detail_targets,
        "detail_strength": detail_strength,
        "return_intermediate": return_intermediate,
    }, None


def round_up_to_multiple(value: int, multiple: int) -> int:
    return max(multiple, ((value + multiple - 1) // multiple) * multiple)


def resolve_detector_model_paths(detail_targets: str, env: dict[str, str] | None = None) -> dict[str, str]:
    if detail_targets != "auto" and detail_targets not in DETECTOR_ENV_BY_TARGET:
        raise RuntimeError("detail_targets must be one of auto, face, hand, person")

    source = os.environ if env is None else env
    targets = AUTO_DETAIL_TARGETS if detail_targets == "auto" else (detail_targets,)
    resolved: dict[str, str] = {}

    for target in targets:
        env_name = DETECTOR_ENV_BY_TARGET[target]
        value = source.get(env_name, "").strip()
        if not value:
            continue

        if not Path(value).exists():
            if detail_targets == "auto":
                continue
            raise RuntimeError(f"Detector model for detail target {target} does not exist: {value}")

        resolved[target] = value

    if detail_targets != "auto" and detail_targets not in resolved:
        raise RuntimeError(
            f"No detector model configured for detail target {detail_targets}. "
            f"Set {DETECTOR_ENV_BY_TARGET[detail_targets]}."
        )

    if detail_targets == "auto" and not resolved:
        raise RuntimeError(
            "No detector models configured for automatic detail enhancement. "
            "Set T2I_FACE_DETECTOR_MODEL or T2I_HAND_DETECTOR_MODEL."
        )

    return resolved


def append_prompt_part(current: str, addition: str) -> str:
    text = (current or "").strip()
    addition = addition.strip()
    if not addition:
        return text
    if not text:
        return addition
    if addition in text:
        return text
    return f"{text}, {addition}"


def apply_realism_preset(request: dict[str, Any]) -> None:
    if not request.get("realism_preset"):
        return

    request["prompt"] = append_prompt_part(request["prompt"], REALISM_PROMPT_SUFFIX)
    request["negative_prompt"] = append_prompt_part(request["negative_prompt"], REALISM_NEGATIVE_PROMPT)


def apply_hires_fix(state: WorkerState, image: Any, request: dict[str, Any], seed: int) -> Any:
    from PIL import Image

    scale = request["hires_scale"]
    target_size = (
        max(1, int(round(image.size[0] * scale))),
        max(1, int(round(image.size[1] * scale))),
    )
    upscaled_image = image.resize(target_size, Image.Resampling.LANCZOS)
    pipe = get_img2img_pipe(state)
    try:
        return run_hires_img2img(state, pipe, upscaled_image, request, seed + 20000)
    except RuntimeError as exc:
        message = str(exc).lower()
        if "invalid buffer size" not in message and "out of memory" not in message:
            raise

    return apply_tiled_hires_fix(state, pipe, upscaled_image, request, seed)


def run_hires_img2img(state: WorkerState, pipe: Any, image: Any, request: dict[str, Any], seed: int) -> Any:
    generator = state.torch.Generator(device=state.pipe.device).manual_seed(seed)
    kwargs = {
        "prompt": request["prompt"],
        "negative_prompt": request["negative_prompt"],
        "image": image,
        "strength": request["hires_denoise"],
        "num_inference_steps": request["hires_steps"],
        "guidance_scale": request["cfg_scale"],
        "generator": generator,
        "clip_skip": 2,
    }

    try:
        result = pipe(**kwargs)
    except TypeError as exc:
        if "clip_skip" not in str(exc):
            raise
        kwargs.pop("clip_skip")
        result = pipe(**kwargs)

    return result.images[0].convert("RGB")


def tile_starts(size: int, tile_size: int) -> list[int]:
    if size <= tile_size:
        return [0]

    starts = [0]
    while starts[-1] + tile_size < size:
        next_start = min(size - tile_size, starts[-1] + tile_size)
        if next_start == starts[-1]:
            break
        starts.append(next_start)
    return starts


def create_tile_mask(tile_size: tuple[int, int], box: tuple[int, int, int, int], image_size: tuple[int, int]) -> Any:
    from PIL import Image, ImageDraw, ImageFilter

    left, top, right, bottom = box
    width, height = tile_size
    fade = min(64, max(1, width // 8), max(1, height // 8))
    mask = Image.new("L", tile_size, 255)
    draw = ImageDraw.Draw(mask)

    if left > 0:
        for x in range(fade):
            draw.line((x, 0, x, height), fill=int(255 * x / fade))
    if top > 0:
        for y in range(fade):
            draw.line((0, y, width, y), fill=int(255 * y / fade))
    if right < image_size[0]:
        for offset in range(fade):
            x = width - 1 - offset
            draw.line((x, 0, x, height), fill=min(mask.getpixel((x, height // 2)), int(255 * offset / fade)))
    if bottom < image_size[1]:
        for offset in range(fade):
            y = height - 1 - offset
            draw.line((0, y, width, y), fill=min(mask.getpixel((width // 2, y)), int(255 * offset / fade)))

    return mask.filter(ImageFilter.GaussianBlur(radius=max(2, fade // 4)))


def apply_tiled_hires_fix(state: WorkerState, pipe: Any, image: Any, request: dict[str, Any], seed: int) -> Any:
    from PIL import Image

    output = image.copy()
    tile_index = 0
    for top in tile_starts(image.size[1], HIRES_TILE_SIZE):
        for left in tile_starts(image.size[0], HIRES_TILE_SIZE):
            right = min(image.size[0], left + HIRES_TILE_SIZE)
            bottom = min(image.size[1], top + HIRES_TILE_SIZE)
            tile = image.crop((left, top, right, bottom)).convert("RGB")
            refined_tile = run_hires_img2img(state, pipe, tile, request, seed + 21000 + tile_index)
            if refined_tile.size != tile.size:
                refined_tile = refined_tile.resize(tile.size, Image.Resampling.LANCZOS)
            mask = create_tile_mask(tile.size, (left, top, right, bottom), image.size)
            output.paste(refined_tile, (left, top), mask)
            tile_index += 1
    return output


def apply_color_temperature(image: Any, shift: float) -> Any:
    from PIL import Image

    if shift == 0:
        return image

    red_scale = max(0, 1 + shift / 100)
    blue_scale = max(0, 1 - shift / 100)
    red, green, blue = image.split()
    red = red.point(lambda value: min(255, int(value * red_scale)))
    blue = blue.point(lambda value: min(255, int(value * blue_scale)))
    return Image.merge("RGB", (red, green, blue))


def apply_bmab_postprocess(image: Any, request: dict[str, Any], seed: int) -> Any:
    from PIL import Image, ImageChops, ImageEnhance

    result = image.convert("RGB")
    result = ImageEnhance.Contrast(result).enhance(request["bmab_contrast"])
    result = ImageEnhance.Brightness(result).enhance(request["bmab_brightness"])
    result = apply_color_temperature(result, request["bmab_color_temperature"])

    alpha = request["bmab_noise_alpha"]
    if alpha <= 0:
        return result

    random_state = random.Random(seed + 30000)
    noise = Image.effect_noise(result.size, 18).convert("L")
    offset = random_state.randint(0, 255)
    noise = noise.point(lambda value: (value + offset) % 256)
    noise_rgb = Image.merge("RGB", (noise, noise, noise))
    return Image.blend(result, ImageChops.screen(result, noise_rgb), alpha)


def expand_box(
    box: tuple[int, int, int, int],
    image_width: int,
    image_height: int,
    padding_ratio: float,
) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    box_width = right - left
    box_height = bottom - top
    pad_x = int(box_width * padding_ratio)
    pad_y = int(box_height * padding_ratio)
    return (
        max(0, left - pad_x),
        max(0, top - pad_y),
        min(image_width, right + pad_x),
        min(image_height, bottom + pad_y),
    )


def create_soft_mask(
    box: tuple[int, int, int, int],
    image_size: tuple[int, int],
    blur_radius: int,
) -> Any:
    from PIL import Image, ImageDraw, ImageFilter

    left, top, right, bottom = box
    draw_box = (left, top, max(left, right - 1), max(top, bottom - 1))
    mask = Image.new("L", image_size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle(draw_box, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(radius=blur_radius))


def get_img2img_pipe(state: WorkerState) -> Any:
    if state.img2img_pipe is not None:
        return state.img2img_pipe

    from diffusers import EulerAncestralDiscreteScheduler, StableDiffusionImg2ImgPipeline

    pipe = StableDiffusionImg2ImgPipeline(**state.pipe.components)
    pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(state.pipe.scheduler.config)
    pipe.to(state.pipe.device)
    state.img2img_pipe = pipe
    return pipe


def get_detector(state: WorkerState, target: str, model_path: str) -> Any:
    cache_key = f"{target}:{model_path}"
    if cache_key in state.detectors:
        return state.detectors[cache_key]

    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise RuntimeError(
            "Missing detail enhancement dependency ultralytics. "
            "Install it with: .venv-t2i/bin/python -m pip install -r requirements-t2i-detail.txt"
        ) from exc

    detector = YOLO(model_path)
    state.detectors[cache_key] = detector
    return detector


def _xyxy_to_list(xyxy: Any) -> list[Any]:
    if hasattr(xyxy, "cpu"):
        xyxy = xyxy.cpu()
    if hasattr(xyxy, "tolist"):
        return xyxy.tolist()
    return list(xyxy)


def detect_regions(state: WorkerState, image: Any, request: dict[str, Any]) -> list[dict[str, Any]]:
    model_paths = resolve_detector_model_paths(request["detail_targets"])
    image_width, image_height = image.size
    regions: list[dict[str, Any]] = []

    for target, model_path in model_paths.items():
        detector = get_detector(state, target, model_path)
        for result in detector.predict(image, verbose=False, conf=0.25, device="cpu"):
            boxes = getattr(result, "boxes", None)
            xyxy = getattr(boxes, "xyxy", None)
            if xyxy is None:
                continue

            for raw_box in _xyxy_to_list(xyxy):
                if len(raw_box) < 4:
                    continue
                left, top, right, bottom = (int(float(value)) for value in raw_box[:4])
                if right <= left or bottom <= top:
                    continue

                expanded_box = expand_box((left, top, right, bottom), image_width, image_height, 0.35)
                if expanded_box[2] <= expanded_box[0] or expanded_box[3] <= expanded_box[1]:
                    continue
                regions.append({"target": target, "box": expanded_box, "detected_box": (left, top, right, bottom)})

    regions.sort(key=lambda region: (region["box"][2] - region["box"][0]) * (region["box"][3] - region["box"][1]), reverse=True)
    return regions[:8]


def refine_region(
    state: WorkerState,
    image: Any,
    region: dict[str, Any],
    request: dict[str, Any],
    seed: int,
    index: int,
) -> Any:
    from PIL import Image

    pipe = get_img2img_pipe(state)
    target = region["target"]
    left, top, right, bottom = region["box"]
    crop = image.crop((left, top, right, bottom)).convert("RGB")
    original_size = crop.size
    resized_size = (
        round_up_to_multiple(original_size[0], 64),
        round_up_to_multiple(original_size[1], 64),
    )
    resized_crop = crop.resize(resized_size, Image.Resampling.LANCZOS)
    prompt = f"{DETAIL_PROMPT_PREFIX[target]}, {request['prompt']}"
    negative_prompt = append_prompt_part(request["negative_prompt"], DETAIL_NEGATIVE_PROMPT.get(target, ""))
    generator = state.torch.Generator(device=state.pipe.device).manual_seed(seed + 10000 + index)
    kwargs = {
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "image": resized_crop,
        "strength": request["detail_strength"],
        "num_inference_steps": max(8, min(request["steps"], 20)),
        "guidance_scale": request["cfg_scale"],
        "generator": generator,
        "clip_skip": 2,
    }

    try:
        result = pipe(**kwargs)
    except TypeError as exc:
        if "clip_skip" not in str(exc):
            raise
        kwargs.pop("clip_skip")
        result = pipe(**kwargs)

    refined_crop = result.images[0].convert("RGB").resize(original_size, Image.Resampling.LANCZOS)
    mask = create_soft_mask((left, top, right, bottom), image.size, max(6, int(min(original_size) * 0.08)))
    patch_canvas = image.copy()
    patch_canvas.paste(refined_crop, (left, top))
    return Image.composite(patch_canvas, image, mask)


def estimate_eye_box(region: dict[str, Any], image_size: tuple[int, int]) -> tuple[int, int, int, int] | None:
    face_box = region.get("detected_box", region["box"])
    face_left, face_top, face_right, face_bottom = face_box
    face_width = face_right - face_left
    face_height = face_bottom - face_top
    if face_width < 16 or face_height < 16:
        return None

    image_width, image_height = image_size
    left = max(0, int(face_left + face_width * 0.12))
    top = max(0, int(face_top + face_height * 0.22))
    right = min(image_width, int(face_right - face_width * 0.12))
    bottom = min(image_height, int(face_top + face_height * 0.56))
    if right - left < 8 or bottom - top < 8:
        return None
    return (left, top, right, bottom)


def refine_eye_region(
    state: WorkerState,
    image: Any,
    region: dict[str, Any],
    request: dict[str, Any],
    seed: int,
    index: int,
) -> tuple[Any, bool]:
    from PIL import Image

    eye_box = estimate_eye_box(region, image.size)
    if eye_box is None:
        return image, False

    left, top, right, bottom = eye_box
    crop = image.crop(eye_box).convert("RGB")
    original_size = crop.size
    resized_size = (
        max(128, round_up_to_multiple(original_size[0], 64)),
        max(128, round_up_to_multiple(original_size[1], 64)),
    )
    resized_crop = crop.resize(resized_size, Image.Resampling.LANCZOS)
    prompt = f"{EYE_REFINE_PROMPT}, {request['prompt']}"
    negative_prompt = append_prompt_part(request["negative_prompt"], EYE_REFINE_NEGATIVE_PROMPT)
    pipe = get_img2img_pipe(state)
    generator = state.torch.Generator(device=state.pipe.device).manual_seed(seed + 12000 + index)
    num_inference_steps = max(
        4,
        min(request["eye_refine_steps"], 20),
        math.ceil(1 / request["eye_refine_strength"]),
    )
    kwargs = {
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "image": resized_crop,
        "strength": request["eye_refine_strength"],
        "num_inference_steps": num_inference_steps,
        "guidance_scale": request["cfg_scale"],
        "generator": generator,
        "clip_skip": 2,
    }

    try:
        result = pipe(**kwargs)
    except TypeError as exc:
        if "clip_skip" not in str(exc):
            raise
        kwargs.pop("clip_skip")
        result = pipe(**kwargs)

    refined_crop = result.images[0].convert("RGB").resize(original_size, Image.Resampling.LANCZOS)
    mask = create_soft_mask(eye_box, image.size, max(3, int(min(original_size) * 0.12)))
    patch_canvas = image.copy()
    patch_canvas.paste(refined_crop, (left, top))
    return Image.composite(patch_canvas, image, mask), True


def enhance_details(state: WorkerState, image: Any, request: dict[str, Any], seed: int) -> tuple[Any, dict[str, Any]]:
    regions = detect_regions(state, image, request)
    if not regions:
        metadata = {
            "detail_enhanced": False,
            "detail_regions": 0,
            "detail_targets": [],
        }
        if request.get("eye_refine", False):
            metadata.update({"eye_refined": False, "eye_regions": 0})
        return image, metadata

    enhanced_image = image
    used_targets: list[str] = []
    applied_detail_regions = 0
    eye_regions = 0
    apply_detail = request.get("detail_enhance", True)
    for index, region in enumerate(regions):
        target = region["target"]
        if target not in used_targets:
            used_targets.append(target)
        if apply_detail:
            enhanced_image = refine_region(state, enhanced_image, region, request, seed, index)
            applied_detail_regions += 1
        if request.get("eye_refine", False) and target == "face":
            enhanced_image, did_refine_eye = refine_eye_region(state, enhanced_image, region, request, seed, index)
            if did_refine_eye:
                eye_regions += 1

    metadata = {
        "detail_enhanced": applied_detail_regions > 0,
        "detail_regions": len(regions),
        "detail_targets": used_targets,
    }
    if request.get("eye_refine", False):
        metadata.update({"eye_refined": eye_regions > 0, "eye_regions": eye_regions})
    return enhanced_image, metadata


def generate_images(state: WorkerState, request: dict[str, Any]) -> list[dict[str, Any]]:
    request = dict(request)
    apply_realism_preset(request)

    output_dir = Path(request["output_dir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    base_seed = request["seed"]
    if base_seed is None:
        base_seed = random.randint(0, 2**31 - 1)

    images: list[dict[str, Any]] = []
    for index in range(request["count"]):
        seed = base_seed + index
        generator = state.torch.Generator(device=state.pipe.device).manual_seed(seed)
        kwargs = {
            "prompt": request["prompt"],
            "negative_prompt": request["negative_prompt"],
            "width": request["width"],
            "height": request["height"],
            "num_inference_steps": request["steps"],
            "guidance_scale": request["cfg_scale"],
            "generator": generator,
            "clip_skip": 2,
        }
        try:
            result = state.pipe(**kwargs)
        except TypeError as exc:
            if "clip_skip" not in str(exc):
                raise
            kwargs.pop("clip_skip")
            result = state.pipe(**kwargs)

        image = result.images[0].convert("RGB")
        if request["return_intermediate"]:
            image.save(output_dir / f"{seed}-base.png")

        hires_metadata: dict[str, Any] = {}
        if request["hires_fix"]:
            image = apply_hires_fix(state, image, request, seed)
            hires_metadata = {
                "hires_upscaled": True,
                "hires_scale": request["hires_scale"],
            }
            if request["return_intermediate"]:
                image.save(output_dir / f"{seed}-hires.png")

        detail_metadata: dict[str, Any] = {}
        if request["detail_enhance"] or request["eye_refine"]:
            image, detail_metadata = enhance_details(state, image, request, seed)

        postprocess_metadata: dict[str, Any] = {}
        if request["bmab_postprocess"]:
            image = apply_bmab_postprocess(image, request, seed)
            postprocess_metadata = {"postprocessed": True}

        file_path = output_dir / f"{seed}.png"
        image.save(file_path)
        images.append({
            "path": str(file_path),
            "seed": seed,
            "width": image.size[0],
            "height": image.size[1],
            **hires_metadata,
            **detail_metadata,
            **postprocess_metadata,
        })

    return images


class T2IHandler(BaseHTTPRequestHandler):
    server: "T2IServer"

    def log_message(self, format: str, *args: Any) -> None:
        return

    def do_GET(self) -> None:
        if self.path != "/health":
            json_response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})
            return

        json_response(self, HTTPStatus.OK, {"ok": True, "model": self.server.state.model_name})

    def do_POST(self) -> None:
        if self.path != "/generate":
            json_response(self, HTTPStatus.NOT_FOUND, {"error": "not found"})
            return

        payload, body_error = read_json_body(self)
        if body_error is not None:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": body_error})
            return

        request, error = validate_payload(payload)
        if error is not None or request is None:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": error})
            return

        if not self.server.state.generation_lock.acquire(blocking=False):
            json_response(self, HTTPStatus.CONFLICT, {"error": "generation already in progress"})
            return

        try:
            images = generate_images(self.server.state, request)
        except Exception as exc:
            json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return
        finally:
            self.server.state.generation_lock.release()

        json_response(self, HTTPStatus.OK, {"model": self.server.state.model_name, "images": images})


class T2IServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], state: WorkerState):
        super().__init__(address, T2IHandler)
        self.state = state


def main() -> int:
    args = parse_args()
    try:
        pipe, torch_module = load_pipeline(args.model_path)
    except RuntimeError as exc:
        print(str(exc), file=os.sys.stderr)
        return 1

    state = WorkerState(args.model_path, pipe, torch_module)
    server = T2IServer((args.host, args.port), state)
    print(f"{DESCRIPTION} listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
