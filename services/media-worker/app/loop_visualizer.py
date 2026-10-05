from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

from .main import download, ffmpeg, sha256_file, upload_file, validate_remote_url


class LoopVisualizerWorkerRequest(BaseModel):
    job_id: str
    job_type: Literal["render_loop_visualizer"]
    payload: dict[str, Any] = Field(default_factory=dict)
    callback_url: str
    callback_token: str


async def render_loop_visualizer_job(payload: dict[str, Any], workdir: Path) -> dict[str, Any]:
    source_url = str(payload.get("source_url") or "").strip()
    audio_url = str(payload.get("audio_url") or "").strip()
    upload_url = str(payload.get("upload_url") or "").strip()
    public_url = str(payload.get("public_url") or "").strip()
    if not source_url or not audio_url or not upload_url or not public_url:
        raise ValueError("source_url, audio_url, upload_url and public_url are required")
    validate_remote_url(upload_url)

    width = int(payload.get("width") or 1080)
    height = int(payload.get("height") or 1920)
    fps = int(payload.get("fps") or 30)
    duration_ms = int(payload.get("duration_ms") or 0)
    if duration_ms < 1000 or duration_ms > 20 * 60 * 1000:
        raise ValueError("Full-track visualizer duration must be between 1 second and 20 minutes.")
    if width < 240 or height < 240 or width > 2160 or height > 3840 or fps < 12 or fps > 60:
        raise ValueError("Invalid visualizer dimensions or frame rate")

    loop_source = workdir / "approved-loop"
    audio_source = workdir / "canonical-audio"
    output = workdir / "full-track-visualizer.mp4"
    await asyncio.gather(download(source_url, loop_source), download(audio_url, audio_source))

    duration = f"{duration_ms / 1000.0:.3f}"
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},fps={fps},setsar=1,format=yuv420p"
    )
    await ffmpeg(
        "-stream_loop",
        "-1",
        "-i",
        str(loop_source),
        "-i",
        str(audio_source),
        "-t",
        duration,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-ar",
        "48000",
        "-shortest",
        "-movflags",
        "+faststart",
        str(output),
    )
    if not output.exists() or output.stat().st_size <= 0:
        raise RuntimeError("Full-track visualizer render produced no output.")

    await upload_file(upload_url, output, "video/mp4")
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
        "audio_source": "canonical_track",
        "audio_processing": "delivery_codec_only",
        "looped_source": True,
    }


async def _callback(request: LoopVisualizerWorkerRequest, status: str, result: dict[str, Any] | None = None, error: str | None = None) -> None:
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
    raise RuntimeError(f"Living Artwork visualizer callback could not be delivered after retries: {last_error}")


async def execute_loop_visualizer(request: LoopVisualizerWorkerRequest) -> str:
    await _callback(request, "running")
    try:
        with tempfile.TemporaryDirectory(prefix="ensemblis-loop-render-") as directory:
            result = await render_loop_visualizer_job(request.payload, Path(directory))
    except Exception as exc:
        await _callback(request, "failed", error=str(exc)[:4000])
        return "failed"
    await _callback(request, "completed", result=result)
    return "completed"
