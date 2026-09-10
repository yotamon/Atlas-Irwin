from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path
from typing import Any, Literal

import httpx
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, Field

from .main import download, ffmpeg, sha256_file, upload_file, validate_remote_url


class SocialWorkerRequest(BaseModel):
    job_id: str
    job_type: Literal["finish_social_video"]
    payload: dict[str, Any] = Field(default_factory=dict)
    callback_url: str
    callback_token: str


def _number(value: Any, default: float = 0.0) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_area(payload: dict[str, Any]) -> dict[str, float]:
    raw = payload.get("safe_area")
    source = raw if isinstance(raw, dict) else {}
    return {
        "top": max(0.0, min(35.0, _number(source.get("topPercent"), 8.0))),
        "right": max(0.0, min(35.0, _number(source.get("rightPercent"), 8.0))),
        "bottom": max(0.0, min(35.0, _number(source.get("bottomPercent"), 18.0))),
        "left": max(0.0, min(35.0, _number(source.get("leftPercent"), 8.0))),
    }


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ]
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size=size)
            except OSError:
                continue
    try:
        return ImageFont.load_default(size=max(16, size // 2))
    except TypeError:
        return ImageFont.load_default()


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> str:
    words = text.replace("\n", " \n ").split()
    lines: list[str] = []
    current = ""
    for word in words:
        if word == "\\n":
            if current:
                lines.append(current)
                current = ""
            continue
        candidate = word if not current else f"{current} {word}"
        bbox = draw.textbbox((0, 0), candidate, font=font, stroke_width=1)
        if bbox[2] - bbox[0] <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return "\n".join(lines[:4])


def _overlay_png(payload: dict[str, Any], workdir: Path, width: int, height: int) -> Path | None:
    text = str(payload.get("overlay_text") or "").strip()
    if not text:
        return None
    text = text[:120]
    safe = _safe_area(payload)
    left = round(width * safe["left"] / 100.0)
    right = round(width * safe["right"] / 100.0)
    top = round(height * safe["top"] / 100.0)
    bottom = round(height * safe["bottom"] / 100.0)
    available_width = max(240, width - left - right)

    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    font_size = max(34, min(76, round(width * 0.054)))
    font = _font(font_size)
    wrapped = _wrap_text(draw, text, font, available_width)
    spacing = max(6, font_size // 5)
    stroke = max(2, font_size // 24)
    bbox = draw.multiline_textbbox((0, 0), wrapped, font=font, spacing=spacing, stroke_width=stroke)
    text_height = bbox[3] - bbox[1]
    y = max(top, height - bottom - text_height)
    x = left

    shadow_offset = max(2, font_size // 18)
    draw.multiline_text(
        (x + shadow_offset, y + shadow_offset),
        wrapped,
        font=font,
        fill=(0, 0, 0, 145),
        spacing=spacing,
        stroke_width=stroke + 1,
        stroke_fill=(0, 0, 0, 90),
    )
    draw.multiline_text(
        (x, y),
        wrapped,
        font=font,
        fill=(245, 245, 242, 255),
        spacing=spacing,
        stroke_width=stroke,
        stroke_fill=(12, 12, 12, 190),
    )
    target = workdir / "deterministic-overlay.png"
    canvas.save(target, format="PNG", optimize=True)
    return target


def _visual_filter(width: int, height: int, fps: int, focus_x: float) -> str:
    focus = max(0.0, min(1.0, focus_x))
    return (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height}:x=(iw-ow)*{focus:.4f}:y=(ih-oh)/2,"
        f"fps={fps},setsar=1,"
        "eq=contrast=1.015:saturation=1.025:brightness=-0.003,"
        "noise=alls=1.1:allf=t+u,format=yuv420p"
    )


async def _render_visual(payload: dict[str, Any], workdir: Path, source: Path, width: int, height: int, fps: int, duration_ms: int) -> Path:
    visual = workdir / "social-visual.mp4"
    focus_x = _number(payload.get("focus_x"), 0.5)
    overlay = _overlay_png(payload, workdir, width, height)
    duration = f"{duration_ms / 1000.0:.3f}"
    vf = _visual_filter(width, height, fps, focus_x)
    if overlay:
        await ffmpeg(
            "-stream_loop", "-1", "-i", str(source),
            "-loop", "1", "-i", str(overlay),
            "-t", duration,
            "-filter_complex", f"[0:v]{vf}[base];[base][1:v]overlay=0:0:shortest=1[v]",
            "-map", "[v]",
            "-an",
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "17",
            "-movflags", "+faststart",
            str(visual),
        )
    else:
        await ffmpeg(
            "-stream_loop", "-1", "-i", str(source),
            "-t", duration,
            "-vf", vf,
            "-an",
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "17",
            "-movflags", "+faststart",
            str(visual),
        )
    return visual


async def _mux_audio(payload: dict[str, Any], workdir: Path, visual: Path, duration_ms: int) -> tuple[Path, str]:
    audio_url = str(payload.get("audio_url") or "").strip()
    output = workdir / "finished-social.mp4"
    if not audio_url:
        shutil.copyfile(visual, output)
        return output, "none"

    audio = workdir / "canonical-audio"
    await download(audio_url, audio)
    start_ms = max(0, int(_number(payload.get("audio_start_ms"), 0.0)))
    await ffmpeg(
        "-i", str(visual),
        "-ss", f"{start_ms / 1000.0:.3f}",
        "-i", str(audio),
        "-t", f"{duration_ms / 1000.0:.3f}",
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "320k",
        "-ar", "48000",
        "-af", "alimiter=limit=0.98",
        "-shortest",
        "-movflags", "+faststart",
        str(output),
    )
    return output, str(payload.get("audio_source") or "canonical")


async def _review_frames(payload: dict[str, Any], workdir: Path, output: Path) -> list[dict[str, Any]]:
    raw_frames = payload.get("review_frames")
    frames = raw_frames if isinstance(raw_frames, list) else []
    results: list[dict[str, Any]] = []
    for index, raw in enumerate(frames[:8]):
        if not isinstance(raw, dict):
            continue
        upload_url = str(raw.get("upload_url") or "")
        public_url = str(raw.get("public_url") or "")
        timestamp_ms = max(0, int(_number(raw.get("timestamp_ms"), 0.0)))
        if not upload_url or not public_url:
            continue
        frame = workdir / f"review-frame-{index + 1:02d}.jpg"
        await ffmpeg(
            "-ss", f"{timestamp_ms / 1000.0:.3f}",
            "-i", str(output),
            "-frames:v", "1",
            "-q:v", "2",
            str(frame),
        )
        if not frame.exists() or frame.stat().st_size <= 0:
            raise RuntimeError(f"QC frame {index + 1} was not rendered")
        await upload_file(upload_url, frame, "image/jpeg")
        results.append({
            "index": index + 1,
            "timestamp_ms": timestamp_ms,
            "public_url": public_url,
            "file_size": frame.stat().st_size,
            "sha256": await asyncio.to_thread(sha256_file, frame),
        })
    if len(results) < 3:
        raise RuntimeError("Social video finishing requires at least three temporal QC frames")
    return results


async def finish_social_video_job(payload: dict[str, Any], workdir: Path) -> dict[str, Any]:
    source_url = str(payload.get("source_url") or "")
    upload_url = str(payload.get("upload_url") or "")
    public_url = str(payload.get("public_url") or "")
    if not source_url or not upload_url or not public_url:
        raise ValueError("source_url, upload_url and public_url are required")
    validate_remote_url(upload_url)

    width = int(_number(payload.get("width"), 1080))
    height = int(_number(payload.get("height"), 1920))
    fps = int(_number(payload.get("fps"), 30))
    duration_ms = max(1000, min(120000, int(_number(payload.get("duration_ms"), 12000))))
    if width < 240 or height < 240 or width > 4096 or height > 4096 or fps < 12 or fps > 60:
        raise ValueError("Invalid social finishing dimensions or frame rate")

    source = workdir / "raw-social-source"
    await download(source_url, source)
    visual = await _render_visual(payload, workdir, source, width, height, fps, duration_ms)
    output, audio_source = await _mux_audio(payload, workdir, visual, duration_ms)
    await upload_file(upload_url, output, "video/mp4")
    frames = await _review_frames(payload, workdir, output)

    return {
        "uploaded": True,
        "public_url": public_url,
        "file_size": output.stat().st_size,
        "mime_type": "video/mp4",
        "sha256": await asyncio.to_thread(sha256_file, output),
        "duration_ms": duration_ms,
        "width": width,
        "height": height,
        "fps": fps,
        "audio_source": audio_source,
        "audio_scene_id": payload.get("audio_scene_id"),
        "platform_package_id": payload.get("platform_package_id"),
        "deterministic_overlay": bool(str(payload.get("overlay_text") or "").strip()),
        "review_frames": frames,
    }


async def _callback(request: SocialWorkerRequest, status: str, result: dict[str, Any] | None = None, error: str | None = None) -> None:
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
                    json={
                        "job_id": request.job_id,
                        "status": status,
                        "result": result or {},
                        "error": error,
                    },
                    headers={"Authorization": f"Bearer {request.callback_token}"},
                )
                response.raise_for_status()
                return
        except (httpx.HTTPError, OSError) as exc:
            last_error = exc
    raise RuntimeError(f"Atlas marketing media callback could not be delivered after retries: {last_error}")


async def execute_social(request: SocialWorkerRequest) -> str:
    await _callback(request, "running")
    try:
        with tempfile.TemporaryDirectory(prefix="atlas-social-") as directory:
            result = await finish_social_video_job(request.payload, Path(directory))
    except Exception as exc:
        await _callback(request, "failed", error=str(exc)[:4000])
        return "failed"
    await _callback(request, "completed", result=result)
    return "completed"
