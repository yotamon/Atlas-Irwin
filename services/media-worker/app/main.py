from __future__ import annotations

import asyncio
import ipaddress
import math
import os
import secrets
import socket
import tempfile
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urljoin, urlparse

import httpx
import librosa
import numpy as np
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Atlas Media Worker", version="1.0.0")
_RUNNING: set[asyncio.Task[Any]] = set()


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
        # Hostname rather than a literal IP. Resolve every address and reject the URL if any
        # result points at a private/local range.
        try:
            for info in socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM):
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
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await process.communicate()
    if process.returncode != 0:
        detail = stderr.decode("utf-8", errors="replace")[-4000:]
        raise RuntimeError(f"FFmpeg failed: {detail}")


def normalized(values: np.ndarray) -> np.ndarray:
    if values.size == 0:
        return values
    low, high = float(np.min(values)), float(np.max(values))
    if math.isclose(high, low):
        return np.full_like(values, 0.5, dtype=float)
    return (values - low) / (high - low)


def analyze_audio_file(path: Path) -> dict[str, Any]:
    y, sr = librosa.load(path, sr=22050, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))
    duration_ms = max(1, int(round(duration * 1000)))
    hop = 512

    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    onset_norm = normalized(onset.astype(float))
    tempo_raw, beat_frames = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop, trim=False)
    tempo_values = np.asarray(tempo_raw).reshape(-1)
    bpm = float(tempo_values[0]) if tempo_values.size and np.isfinite(tempo_values[0]) else None
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)
    beats_ms = [int(round(value * 1000)) for value in beat_times if value <= duration]

    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    rms_norm = normalized(rms.astype(float))
    rms_times = librosa.frames_to_time(np.arange(len(rms_norm)), sr=sr, hop_length=hop)
    sample_step = max(1, int(round(len(rms_norm) / 80)))
    energy_curve = [
        {"ms": int(round(rms_times[index] * 1000)), "value": round(float(rms_norm[index]), 4)}
        for index in range(0, len(rms_norm), sample_step)
        if rms_times[index] <= duration
    ]
    if not energy_curve or energy_curve[-1]["ms"] < duration_ms:
        energy_curve.append({"ms": duration_ms, "value": round(float(rms_norm[-1]) if rms_norm.size else 0.5, 4)})

    target_sections = int(np.clip(round(duration / 32), 4, 8))
    try:
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
        raw_boundaries = librosa.segment.agglomerative(chroma, k=target_sections)
        boundary_seconds = librosa.frames_to_time(raw_boundaries, sr=sr, hop_length=hop)
        boundaries = sorted({0, *[int(round(value * 1000)) for value in boundary_seconds], duration_ms})
    except Exception:
        boundaries = [int(round(duration_ms * index / target_sections)) for index in range(target_sections + 1)]
    boundaries = [value for value in boundaries if 0 <= value <= duration_ms]
    if not boundaries or boundaries[0] != 0:
        boundaries.insert(0, 0)
    if boundaries[-1] != duration_ms:
        boundaries.append(duration_ms)
    if len(boundaries) - 1 < 3:
        boundaries = [int(round(duration_ms * index / 4)) for index in range(5)]

    section_energies: list[float] = []
    for start_ms, end_ms in zip(boundaries[:-1], boundaries[1:]):
        mask = (rms_times * 1000 >= start_ms) & (rms_times * 1000 < end_ms)
        local = rms_norm[mask]
        section_energies.append(round(float(np.mean(local)) if local.size else 0.5, 4))

    interior = section_energies[1:-1]
    lowest_interior = 1 + int(np.argmin(interior)) if interior else -1
    highest_interior = 1 + int(np.argmax(interior)) if interior else -1
    sections: list[dict[str, Any]] = []
    for index, (start_ms, end_ms) in enumerate(zip(boundaries[:-1], boundaries[1:])):
        if index == 0:
            label, section_type = "Intro", "intro"
        elif index == len(boundaries) - 2:
            label, section_type = "Finale", "finale"
        elif index == lowest_interior:
            label, section_type = "Breakdown", "breakdown"
        elif index == highest_interior:
            label, section_type = "Hook", "hook"
        elif index < len(boundaries) / 2:
            label, section_type = "Build", "build"
        else:
            label, section_type = "Development", "development"
        sections.append({"id": f"section-{index + 1}", "label": label, "type": section_type, "start_ms": start_ms, "end_ms": end_ms, "energy": section_energies[index]})

    def onset_at(ms: int) -> float:
        frame = int(librosa.time_to_frames(ms / 1000, sr=sr, hop_length=hop))
        lo, hi = max(0, frame - 3), min(len(onset_norm), frame + 4)
        return float(np.max(onset_norm[lo:hi])) if hi > lo else 0.25

    edit_points = [{"ms": section["start_ms"], "confidence": round(0.55 + 0.44 * onset_at(section["start_ms"]), 3), "reason": f"Detected structural transition into {section['label'].lower()}."} for section in sections[1:]]
    peak_candidates = np.argsort(rms_norm)[::-1] if rms_norm.size else []
    peaks_ms: list[int] = []
    for index in peak_candidates:
        ms = int(round(rms_times[int(index)] * 1000))
        if all(abs(ms - existing) >= 8000 for existing in peaks_ms):
            peaks_ms.append(ms)
        if len(peaks_ms) >= 4:
            break
    peaks_ms.sort()

    beat_confidence = 0.0
    if beat_frames.size and onset.size:
        beat_strength = onset[np.clip(beat_frames, 0, len(onset) - 1)]
        beat_confidence = float(np.clip(np.mean(normalized(beat_strength.astype(float))), 0, 1))

    return {
        "version": 1,
        "duration_ms": duration_ms,
        "bpm": round(bpm, 2) if bpm else None,
        "beat_confidence": round(beat_confidence, 3),
        "beats_ms": beats_ms,
        "downbeats_ms": beats_ms[::4],
        "sections": sections,
        "energy_curve": energy_curve,
        "edit_points": edit_points,
        "peaks_ms": peaks_ms,
        "source": "worker",
    }


async def analyze_job(payload: dict[str, Any], workdir: Path) -> dict[str, Any]:
    audio_url = str(payload.get("audio_url") or "")
    if not audio_url:
        raise ValueError("audio_url is required")
    audio_path = workdir / "source-audio"
    await download(audio_url, audio_path)
    return {"music_map": await asyncio.to_thread(analyze_audio_file, audio_path)}


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

    width, height, fps = int(payload.get("width") or 1920), int(payload.get("height") or 1080), int(payload.get("fps") or 30)
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
        source, segment = workdir / f"clip-{index:03d}.source", workdir / f"clip-{index:03d}.mp4"
        await download(url, source)
        args: list[str] = ["-stream_loop", "-1", "-i", str(source)]
        if source_offset_ms:
            args = ["-ss", f"{source_offset_ms / 1000:.3f}", *args]
        args += ["-t", f"{duration_ms / 1000:.3f}", "-vf", crop_filter(width, height, fps, focus_x), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", str(segment)]
        await ffmpeg(*args)
        segment_paths.append(segment)

    concat_file = workdir / "concat.txt"
    concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in segment_paths), encoding="utf-8")
    picture = workdir / "picture.mp4"
    await ffmpeg("-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(picture))

    audio, output = workdir / "master-audio", workdir / "output.mp4"
    await download(audio_url, audio)
    start_ms = max(0, int(payload.get("audio_start_ms") or 0))
    target_duration_ms = int(payload.get("duration_ms") or sum(int(clip.get("duration_ms") or 0) for clip in clips))
    await ffmpeg("-i", str(picture), "-ss", f"{start_ms / 1000:.3f}", "-i", str(audio), "-t", f"{target_duration_ms / 1000:.3f}", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-shortest", "-movflags", "+faststart", str(output))

    await upload_file(upload_url, output, "video/mp4")
    return {"uploaded": True, "file_size": output.stat().st_size, "mime_type": "video/mp4", "duration_ms": target_duration_ms, "width": width, "height": height}


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
        "-ss", f"{timestamp_ms / 1000:.3f}",
        "-i", str(source),
        "-frames:v", "1",
        "-vf", f"scale=w='min({max_width},iw)':h=-2",
        "-q:v", "2",
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


async def callback(request: WorkerRequest, status: str, result: dict[str, Any] | None = None, error: str | None = None) -> None:
    validate_remote_url(request.callback_url)
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(request.callback_url, json={"job_id": request.job_id, "status": status, "result": result or {}, "error": error}, headers={"Authorization": f"Bearer {request.callback_token}"})
        response.raise_for_status()


async def execute(request: WorkerRequest) -> None:
    try:
        await callback(request, "running")
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
        await callback(request, "completed", result=result)
    except Exception as exc:
        try:
            await callback(request, "failed", error=str(exc)[:4000])
        except Exception:
            pass


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "active_jobs": len(_RUNNING)}


@app.post("/v1/jobs", status_code=202)
async def submit_job(request: WorkerRequest, authorization: str | None = Header(default=None)) -> dict[str, str]:
    authenticate(authorization)
    task = asyncio.create_task(execute(request))
    _RUNNING.add(task)
    task.add_done_callback(_RUNNING.discard)
    return {"job_id": request.job_id, "status": "queued"}
