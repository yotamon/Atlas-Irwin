from __future__ import annotations

import asyncio
import re
import tempfile
from pathlib import Path
from typing import Any, Literal

import httpx
import numpy as np

from pydantic import BaseModel, Field

from .main import FFMPEG_BINARY, download, ffmpeg, sha256_file, upload_file, validate_remote_url


class LoopNormalizeWorkerRequest(BaseModel):
    job_id: str
    job_type: Literal["normalize_loop_video"]
    payload: dict[str, Any] = Field(default_factory=dict)
    callback_url: str
    callback_token: str


async def _probe_duration_seconds(path: Path) -> float:
    process = await asyncio.create_subprocess_exec(
        FFMPEG_BINARY,
        "-hide_banner",
        "-i",
        str(path),
        "-f",
        "null",
        "-",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await process.communicate()
    text = stderr.decode("utf-8", errors="replace")
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if not match:
        raise RuntimeError("Could not determine loop duration.")
    hours, minutes, seconds = match.groups()
    duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    if duration <= 0:
        raise RuntimeError("Loop duration must be positive.")
    return duration


async def _extract_boundary_frames(path: Path, workdir: Path) -> dict[str, Path]:
    frames = {
        "first": workdir / "loop-first.png",
        "start_window": workdir / "loop-start-window.png",
        "end_window": workdir / "loop-end-window.png",
        "last": workdir / "loop-last.png",
    }
    await ffmpeg("-ss", "0.000", "-i", str(path), "-frames:v", "1", "-vf", "scale=256:256", str(frames["first"]))
    await ffmpeg("-ss", "0.120", "-i", str(path), "-frames:v", "1", "-vf", "scale=256:256", str(frames["start_window"]))
    await ffmpeg("-sseof", "-0.170", "-i", str(path), "-frames:v", "1", "-vf", "scale=256:256", str(frames["end_window"]))
    await ffmpeg("-sseof", "-0.050", "-i", str(path), "-frames:v", "1", "-vf", "scale=256:256", str(frames["last"]))
    if any(not frame.exists() for frame in frames.values()):
        raise RuntimeError("Could not extract loop boundary frames.")
    return frames


def _pair_metrics_arrays(first: np.ndarray, last: np.ndarray) -> dict[str, float]:
    if first.shape != last.shape:
        raise ValueError("Loop boundary frames must have matching dimensions.")
    first = np.asarray(first, dtype=np.float32)
    last = np.asarray(last, dtype=np.float32)
    rmse = float(np.sqrt(np.mean(np.square(first - last))) / 255.0)
    similarity = max(0.0, min(1.0, 1.0 - rmse))
    luminance_delta = float(abs(first.mean() - last.mean()) / 255.0)
    first_channels = first.reshape(-1, first.shape[-1]).mean(axis=0)
    last_channels = last.reshape(-1, last.shape[-1]).mean(axis=0)
    color_delta = float(np.mean(np.abs(first_channels - last_channels)) / 255.0)
    return {
        "similarity": round(similarity, 5),
        "luminance_delta": round(luminance_delta, 5),
        "color_delta": round(color_delta, 5),
    }


def _classify_boundary(endpoint: dict[str, float], window: dict[str, float]) -> str:
    effective_similarity = min(endpoint["similarity"], window["similarity"])
    luminance_delta = max(endpoint["luminance_delta"], window["luminance_delta"])
    color_delta = max(endpoint["color_delta"], window["color_delta"])
    if effective_similarity >= 0.92 and luminance_delta <= 0.05 and color_delta <= 0.06:
        return "ready"
    if effective_similarity >= 0.80 and luminance_delta <= 0.12 and color_delta <= 0.14:
        return "repair_available"
    return "needs_review"


def _boundary_metrics_arrays(first: np.ndarray, last: np.ndarray) -> dict[str, float | str]:
    endpoint = _pair_metrics_arrays(first, last)
    return {**endpoint, "state": _classify_boundary(endpoint, endpoint)}


def _load_rgb(path: Path) -> np.ndarray:
    # Pillow is part of the production worker image, but importing it lazily keeps
    # unrelated audio-only test profiles able to import the shared worker runner.
    from PIL import Image

    with Image.open(path) as image:
        return np.asarray(image.convert("RGB"), dtype=np.float32)


def _boundary_metrics(frames: dict[str, Path]) -> dict[str, float | str | bool]:
    first = _load_rgb(frames["first"])
    start_window = _load_rgb(frames["start_window"])
    end_window = _load_rgb(frames["end_window"])
    last = _load_rgb(frames["last"])

    endpoint = _pair_metrics_arrays(first, last)
    window = _pair_metrics_arrays(start_window, end_window)
    start_motion = 1.0 - _pair_metrics_arrays(first, start_window)["similarity"]
    end_motion = 1.0 - _pair_metrics_arrays(end_window, last)["similarity"]
    freeze_suspected = max(start_motion, end_motion) < 0.002

    return {
        "state": _classify_boundary(endpoint, window),
        "similarity": endpoint["similarity"],
        "boundary_window_similarity": window["similarity"],
        "luminance_delta": max(endpoint["luminance_delta"], window["luminance_delta"]),
        "color_delta": max(endpoint["color_delta"], window["color_delta"]),
        "freeze_suspected": freeze_suspected,
    }


async def _normalize(source: Path, target: Path, width: int, height: int, fps: int) -> None:
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},fps={fps},setsar=1,format=yuv420p"
    )
    await ffmpeg(
        "-i",
        str(source),
        "-t",
        "20",
        "-vf",
        vf,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "17",
        "-movflags",
        "+faststart",
        str(target),
    )


async def _repair_seam(source: Path, target: Path, duration_seconds: float) -> int:
    crossfade = min(0.35, max(0.18, duration_seconds * 0.06))
    if duration_seconds <= (crossfade * 2) + 0.75:
        raise RuntimeError("Loop is too short for deterministic seam repair.")
    middle_end = duration_seconds - crossfade
    filter_complex = (
        f"[0:v]trim=start={crossfade:.4f}:end={middle_end:.4f},setpts=PTS-STARTPTS[mid];"
        f"[0:v]trim=start={middle_end:.4f}:end={duration_seconds:.4f},setpts=PTS-STARTPTS[tail];"
        f"[0:v]trim=start=0:end={crossfade:.4f},setpts=PTS-STARTPTS[head];"
        f"[tail][head]xfade=transition=fade:duration={crossfade:.4f}:offset=0[seam];"
        "[mid][seam]concat=n=2:v=1:a=0[out]"
    )
    await ffmpeg(
        "-i",
        str(source),
        "-filter_complex",
        filter_complex,
        "-map",
        "[out]",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "17",
        "-movflags",
        "+faststart",
        str(target),
    )
    return round(crossfade * 1000)


async def normalize_loop_video_job(payload: dict[str, Any], workdir: Path) -> dict[str, Any]:
    source_url = str(payload.get("source_url") or "").strip()
    upload_url = str(payload.get("upload_url") or "").strip()
    public_url = str(payload.get("public_url") or "").strip()
    repair_policy = str(payload.get("repair_policy") or "none")
    if not source_url or not upload_url or not public_url:
        raise ValueError("source_url, upload_url and public_url are required")
    if repair_policy not in {"none", "auto"}:
        raise ValueError("repair_policy must be none or auto")
    validate_remote_url(upload_url)

    width = int(payload.get("width") or 1080)
    height = int(payload.get("height") or 1920)
    fps = int(payload.get("fps") or 30)
    if width < 240 or height < 240 or width > 2160 or height > 3840 or fps < 12 or fps > 60:
        raise ValueError("Invalid loop normalization dimensions or frame rate")

    source = workdir / "raw-loop-source"
    normalized = workdir / "normalized-loop.mp4"
    await download(source_url, source)
    await _normalize(source, normalized, width, height, fps)
    duration = await _probe_duration_seconds(normalized)
    if duration < 1.0 or duration > 20.5:
        raise RuntimeError("Living Artwork loops must be between 1 and 20 seconds.")

    frames = await _extract_boundary_frames(normalized, workdir)
    before = _boundary_metrics(frames)
    output = normalized
    repair_ms = 0
    repaired = False

    if before["state"] == "repair_available" and repair_policy == "auto":
        repaired_output = workdir / "repaired-loop.mp4"
        repair_ms = await _repair_seam(normalized, repaired_output, duration)
        repaired_duration = await _probe_duration_seconds(repaired_output)
        repaired_frames = await _extract_boundary_frames(repaired_output, workdir)
        after = _boundary_metrics(repaired_frames)
        if after["state"] == "repair_available":
            # One deterministic repair attempt is the bounded policy. If the seam
            # remains imperfect, hand the result to the artist rather than looping.
            after = {**after, "state": "needs_review"}
        output = repaired_output
        duration = repaired_duration
        repaired = True
    else:
        after = before

    await upload_file(upload_url, output, "video/mp4")
    return {
        "uploaded": True,
        "public_url": public_url,
        "file_size": output.stat().st_size,
        "mime_type": "video/mp4",
        "sha256": await asyncio.to_thread(sha256_file, output),
        "duration_ms": round(duration * 1000),
        "width": width,
        "height": height,
        "fps": fps,
        "seam_state": after["state"],
        "seam_similarity": after["similarity"],
        "boundary_window_similarity": after["boundary_window_similarity"],
        "luminance_delta": after["luminance_delta"],
        "color_delta": after["color_delta"],
        "frame_count_estimate": round(duration * fps),
        "freeze_suspected": after["freeze_suspected"],
        "repaired": repaired,
        "repair_ms": repair_ms,
        "before_repair": before if repaired else None,
    }


async def _callback(request: LoopNormalizeWorkerRequest, status: str, result: dict[str, Any] | None = None, error: str | None = None) -> None:
    validate_remote_url(request.callback_url)
    delays = (0, 1, 3, 7, 15)
    last_error: Exception | None = None
    for delay in delays:
        if delay:
            await asyncio.sleep(delay)
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    request.callback_url,
                    json={"job_id": request.job_id, "status": status, "result": result or {}, "error": error},
                    headers={"Authorization": f"Bearer {request.callback_token}"},
                )
                response.raise_for_status()
                return
        except (httpx.HTTPError, OSError) as exc:
            last_error = exc
    raise RuntimeError(f"Living Artwork loop callback could not be delivered after retries: {last_error}")


async def execute_loop_normalization(request: LoopNormalizeWorkerRequest) -> str:
    await _callback(request, "running")
    try:
        with tempfile.TemporaryDirectory(prefix="ensemblis-loop-normalize-") as directory:
            result = await normalize_loop_video_job(request.payload, Path(directory))
    except Exception as exc:
        await _callback(request, "failed", error=str(exc)[:4000])
        return "failed"
    await _callback(request, "completed", result=result)
    return "completed"
