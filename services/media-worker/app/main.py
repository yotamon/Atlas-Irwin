from __future__ import annotations

import asyncio
import ipaddress
import os
import re
import secrets
import socket
import tempfile
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from google.api_core.exceptions import AlreadyExists
from google.cloud import tasks_v2
from google.protobuf import duration_pb2
from pydantic import BaseModel, Field

from .music_intelligence import allin1_infer, analyze_music

app = FastAPI(title="Atlas Media Worker", version="2.1.0")
_RUNNING: set[asyncio.Task[Any]] = set()
_ACTIVE_JOB_IDS: set[str] = set()


class WorkerRequest(BaseModel):
    job_id: str
    job_type: Literal[
        "analyze_audio",
        "extract_audio_segment",
        "extract_frame",
        "render_master",
        "render_social",
        "render_promo",
        "render_hook",
    ]
    payload: dict[str, Any] = Field(default_factory=dict)
    callback_url: str
    callback_token: str


def worker_secret() -> str:
    value = os.getenv("MEDIA_WORKER_SECRET", "").strip()
    if not value:
        raise RuntimeError("MEDIA_WORKER_SECRET is required")
    return value


def authenticate(authorization: str | None) -> None:
    expected = f"Bearer {worker_secret()}"
    if not authorization or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def authenticate_task(value: str | None) -> None:
    expected = worker_secret()
    if not value or not secrets.compare_digest(value, expected):
        raise HTTPException(status_code=401, detail="Unauthorized task delivery")


def cloud_tasks_config() -> tuple[str, str, str] | None:
    project = os.getenv("GCP_PROJECT_ID", "").strip()
    location = os.getenv("CLOUD_TASKS_LOCATION", "").strip()
    queue = os.getenv("CLOUD_TASKS_QUEUE", "").strip()
    if project and location and queue:
        return project, location, queue
    return None


def _reject_private_address(address: str) -> None:
    ip = ipaddress.ip_address(address)
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
        raise ValueError("Private network URLs are not allowed")


def validate_remote_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname:
        raise ValueError("Only HTTP(S) media URLs are supported")
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname in {"localhost", "metadata.google.internal"} or hostname.endswith(".internal"):
        raise ValueError("Local or metadata URLs are not allowed")
    try:
        _reject_private_address(hostname)
    except ValueError as exc:
        if "Private network" in str(exc):
            raise
        try:
            for info in socket.getaddrinfo(
                hostname,
                parsed.port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            ):
                _reject_private_address(info[4][0])
        except socket.gaierror as dns_error:
            raise ValueError(f"Could not resolve remote media host: {hostname}") from dns_error
    return value


async def download(url: str, target: Path, limit_bytes: int = 600 * 1024 * 1024) -> None:
    timeout = httpx.Timeout(120.0, connect=20.0)
    current = validate_remote_url(url)
    total = 0
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        for _ in range(6):
            async with client.stream("GET", current) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        raise ValueError("Remote media redirect did not include a location")
                    current = validate_remote_url(urljoin(current, location))
                    continue
                response.raise_for_status()
                with target.open("wb") as handle:
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        if total > limit_bytes:
                            raise ValueError("Remote media exceeds worker download limit")
                        handle.write(chunk)
                return
        raise ValueError("Remote media exceeded redirect limit")


async def upload_file(upload_url: str, path: Path, content_type: str) -> None:
    validate_remote_url(upload_url)
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=20.0)) as client:
        with path.open("rb") as handle:
            response = await client.put(
                upload_url,
                content=handle.read(),
                headers={
                    "content-type": content_type,
                    "cache-control": "max-age=31536000",
                    "x-upsert": "false",
                },
            )
        response.raise_for_status()


async def ffmpeg(*args: str) -> None:
    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await process.communicate()
    if process.returncode != 0:
        detail = stderr.decode("utf-8", errors="replace")[-4000:]
        raise RuntimeError(f"FFmpeg failed: {detail}")


async def analyze_job(payload: dict[str, Any], workdir: Path) -> dict[str, Any]:
    audio_url = str(payload.get("audio_url") or "")
    if not audio_url:
        raise ValueError("audio_url is required")
    source_path = workdir / "source-audio"
    analysis_path = workdir / "analysis-source.wav"
    await download(audio_url, source_path)
    # Standardize the decoder/timing domain before beat tracking. Lossy formats can differ
    # by tens of milliseconds between decoders; PCM WAV makes every downstream analyzer
    # operate on the exact same sample timeline.
    await ffmpeg(
        "-i",
        str(source_path),
        "-vn",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-c:a",
        "pcm_s16le",
        str(analysis_path),
    )
    return {"music_map": await asyncio.to_thread(analyze_music, analysis_path)}


def crop_filter(width: int, height: int, fps: int, focus_x: float) -> str:
    focus = max(0.0, min(1.0, focus_x))
    return (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height}:x=(iw-ow)*{focus:.4f}:y=(ih-oh)/2,"
        f"fps={fps},setsar=1,format=yuv420p"
    )


async def render_job(payload: dict[str, Any], workdir: Path) -> dict[str, Any]:
    clips = payload.get("clips")
    audio_url = str(payload.get("audio_url") or "")
    upload_url = str(payload.get("upload_url") or "")
    if not isinstance(clips, list) or not clips:
        raise ValueError("clips are required")
    if not audio_url or not upload_url:
        raise ValueError("audio_url and upload_url are required")
    validate_remote_url(upload_url)

    width = int(payload.get("width") or 1920)
    height = int(payload.get("height") or 1080)
    fps = int(payload.get("fps") or 30)
    if width < 240 or height < 240 or width > 4096 or height > 4096 or fps < 12 or fps > 60:
        raise ValueError("Invalid render dimensions or frame rate")

    segment_paths: list[Path] = []
    for index, clip in enumerate(clips):
        if not isinstance(clip, dict):
            raise ValueError("Invalid clip manifest")
        url = str(clip.get("url") or "")
        duration_ms = int(clip.get("duration_ms") or 0)
        source_offset_ms = max(0, int(clip.get("source_offset_ms") or 0))
        focus_x = float(clip.get("focus_x") if isinstance(clip.get("focus_x"), (int, float)) else 0.5)
        if not url or duration_ms <= 0:
            raise ValueError("Each clip requires url and positive duration_ms")
        source = workdir / f"clip-{index:03d}.source"
        segment = workdir / f"clip-{index:03d}.mp4"
        await download(url, source)
        args: list[str] = ["-stream_loop", "-1", "-i", str(source)]
        if source_offset_ms:
            args = ["-ss", f"{source_offset_ms / 1000:.3f}", *args]
        args += [
            "-t",
            f"{duration_ms / 1000:.3f}",
            "-vf",
            crop_filter(width, height, fps, focus_x),
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-movflags",
            "+faststart",
            str(segment),
        ]
        await ffmpeg(*args)
        segment_paths.append(segment)

    concat_file = workdir / "concat.txt"
    concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in segment_paths), encoding="utf-8")
    picture = workdir / "picture.mp4"
    await ffmpeg("-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(picture))

    audio = workdir / "master-audio"
    output = workdir / "output.mp4"
    await download(audio_url, audio)
    start_ms = max(0, int(payload.get("audio_start_ms") or 0))
    target_duration_ms = int(
        payload.get("duration_ms")
        or sum(int(clip.get("duration_ms") or 0) for clip in clips)
    )
    await ffmpeg(
        "-i",
        str(picture),
        "-ss",
        f"{start_ms / 1000:.3f}",
        "-i",
        str(audio),
        "-t",
        f"{target_duration_ms / 1000:.3f}",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(output),
    )

    await upload_file(upload_url, output, "video/mp4")
    return {
        "uploaded": True,
        "file_size": output.stat().st_size,
        "mime_type": "video/mp4",
        "duration_ms": target_duration_ms,
        "width": width,
        "height": height,
    }


async def extract_frame_job(payload: dict[str, Any], workdir: Path) -> dict[str, Any]:
    source_url = str(payload.get("source_url") or "")
    upload_url = str(payload.get("upload_url") or "")
    timestamp_ms = max(0, int(payload.get("timestamp_ms") or 0))
    max_width = max(640, min(2560, int(payload.get("max_width") or 1600)))
    if not source_url or not upload_url:
        raise ValueError("source_url and upload_url are required")

    source = workdir / "thumbnail-source"
    output = workdir / "thumbnail.jpg"
    await download(source_url, source)
    await ffmpeg(
        "-ss",
        f"{timestamp_ms / 1000:.3f}",
        "-i",
        str(source),
        "-frames:v",
        "1",
        "-vf",
        f"scale=w='min({max_width},iw)':h=-2",
        "-q:v",
        "2",
        str(output),
    )
    if not output.exists() or output.stat().st_size <= 0:
        raise RuntimeError("FFmpeg did not produce a thumbnail frame")
    await upload_file(upload_url, output, "image/jpeg")
    return {
        "uploaded": True,
        "file_size": output.stat().st_size,
        "mime_type": "image/jpeg",
        "timestamp_ms": timestamp_ms,
        "width": max_width,
    }


async def callback(
    request: WorkerRequest,
    status: str,
    result: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    validate_remote_url(request.callback_url)
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


async def execute(request: WorkerRequest) -> str:
    _ACTIVE_JOB_IDS.add(request.job_id)
    try:
        await callback(request, "running")
        try:
            with tempfile.TemporaryDirectory(prefix="atlas-video-") as directory:
                workdir = Path(directory)
                if request.job_type == "analyze_audio":
                    result = await analyze_job(request.payload, workdir)
                elif request.job_type == "extract_frame":
                    result = await extract_frame_job(request.payload, workdir)
                elif request.job_type in {"render_master", "render_social", "render_promo", "render_hook"}:
                    result = await render_job(request.payload, workdir)
                else:
                    raise ValueError(f"Unsupported worker job type: {request.job_type}")
        except Exception as exc:
            # The media operation failed. A successful failed-callback is terminal from Cloud
            # Tasks' perspective; only callback transport failure should trigger a queue retry.
            await callback(request, "failed", error=str(exc)[:4000])
            return "failed"

        # If this callback cannot be delivered, propagate the exception so Cloud Tasks retries
        # the delivery. Atlas callback reconciliation is idempotent for duplicate terminal calls.
        await callback(request, "completed", result=result)
        return "completed"
    finally:
        _ACTIVE_JOB_IDS.discard(request.job_id)


def enqueue_cloud_task(request: WorkerRequest, execution_url: str) -> str:
    config = cloud_tasks_config()
    if not config:
        raise RuntimeError("Cloud Tasks is not configured")
    project, location, queue = config
    validate_remote_url(execution_url)
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(project, location, queue)
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "-", request.job_id)[:400]
    task_name = client.task_path(project, location, queue, f"atlas-{safe_id}")
    task = tasks_v2.Task(
        name=task_name,
        http_request=tasks_v2.HttpRequest(
            http_method=tasks_v2.HttpMethod.POST,
            url=execution_url,
            headers={
                "Content-Type": "application/json",
                "X-Atlas-Worker-Task": worker_secret(),
            },
            body=request.model_dump_json().encode("utf-8"),
        ),
        dispatch_deadline=duration_pb2.Duration(seconds=1800),
    )
    try:
        created = client.create_task(parent=parent, task=task)
        return created.name
    except AlreadyExists:
        # Explicit task IDs make Vercel retries safe. The existing Cloud Task owns delivery.
        return task_name


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "version": 2.1,
        "dispatch_mode": "cloud_tasks" if cloud_tasks_config() else "local_background",
        "music_intelligence": {
            "semantic_analyzer_available": allin1_infer is not None,
        },
        "active_jobs": len(_ACTIVE_JOB_IDS),
    }


@app.post("/v1/execute")
async def execute_task(
    job: WorkerRequest,
    x_atlas_worker_task: str | None = Header(default=None),
) -> dict[str, str]:
    authenticate_task(x_atlas_worker_task)
    status = await execute(job)
    return {"job_id": job.job_id, "status": status}


@app.post("/v1/jobs", status_code=202)
async def submit_job(
    job: WorkerRequest,
    http_request: Request,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authenticate(authorization)
    if cloud_tasks_config():
        execution_url = f"{str(http_request.base_url).rstrip('/')}/v1/execute"
        task_name = await asyncio.to_thread(enqueue_cloud_task, job, execution_url)
        return {"job_id": job.job_id, "status": "queued", "task": task_name}

    # Local/dev compatibility only. Production deploys configure Cloud Tasks so work remains
    # attached to a durable HTTP request and Cloud Run can safely scale to zero when idle.
    task = asyncio.create_task(execute(job))
    _RUNNING.add(task)
    task.add_done_callback(_RUNNING.discard)
    return {"job_id": job.job_id, "status": "queued"}
