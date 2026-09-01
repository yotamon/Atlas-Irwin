from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import math
import socket
import tempfile
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urljoin, urlparse

import httpx
import imageio_ffmpeg
import numpy as np
import soundfile as sf
from pydantic import BaseModel, Field

from .music_intelligence import analyze_music
from .stem_intelligence import analyze_stem

FFMPEG_BINARY = imageio_ffmpeg.get_ffmpeg_exe()
AUDIO_SCENE_SR = 44100


class WorkerRequest(BaseModel):
    job_id: str
    job_type: Literal[
        "analyze_audio",
        "analyze_stem",
        "extract_frame",
        "render_master",
        "render_social",
        "render_promo",
        "render_hook",
        "render_audio_scene",
    ]
    payload: dict[str, Any] = Field(default_factory=dict)
    callback_url: str
    callback_token: str


def _reject_private_address(address: str) -> None:
    ip = ipaddress.ip_address(address)
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
        raise ValueError("Private network URLs are not allowed")


def validate_remote_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname:
        raise ValueError("Only HTTP(S) media URLs are supported")
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith(".internal"):
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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
        FFMPEG_BINARY,
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


async def decode_analysis_audio(source: Path, target: Path) -> None:
    await ffmpeg(
        "-i",
        str(source),
        "-vn",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-c:a",
        "pcm_s16le",
        str(target),
    )


async def analyze_job(payload: dict[str, Any], workdir: Path) -> dict[str, Any]:
    audio_url = str(payload.get("audio_url") or "")
    if not audio_url:
        raise ValueError("audio_url is required")
    source_path = workdir / "source-audio"
    analysis_path = workdir / "analysis-source.wav"
    await download(audio_url, source_path)
    source_sha256 = await asyncio.to_thread(sha256_file, source_path)
    await decode_analysis_audio(source_path, analysis_path)
    analysis_sha256 = await asyncio.to_thread(sha256_file, analysis_path)
    source_audio = {
        "url": str(payload.get("source_audio_url") or audio_url),
        "media_asset_id": payload.get("source_media_asset_id") if isinstance(payload.get("source_media_asset_id"), str) else None,
        "audio_sha256": source_sha256,
        "analysis_pcm_sha256": analysis_sha256,
    }
    music_map = await asyncio.to_thread(analyze_music, analysis_path, source_audio)
    return {"music_map": music_map}


async def analyze_stem_job(payload: dict[str, Any], workdir: Path) -> dict[str, Any]:
    stem_url = str(payload.get("stem_url") or "")
    master_url = str(payload.get("master_url") or "")
    category = str(payload.get("category") or "other").strip().lower() or "other"
    if not stem_url or not master_url:
        raise ValueError("stem_url and master_url are required")

    stem_source = workdir / "stem-source"
    master_source = workdir / "master-source"
    stem_pcm = workdir / "stem-analysis.wav"
    master_pcm = workdir / "master-analysis.wav"
    await asyncio.gather(download(stem_url, stem_source), download(master_url, master_source))
    stem_source_sha = await asyncio.to_thread(sha256_file, stem_source)
    await asyncio.gather(decode_analysis_audio(stem_source, stem_pcm), decode_analysis_audio(master_source, master_pcm))
    stem_pcm_sha = await asyncio.to_thread(sha256_file, stem_pcm)
    sections_raw = payload.get("sections")
    sections = [item for item in sections_raw if isinstance(item, dict)] if isinstance(sections_raw, list) else []
    analysis = await asyncio.to_thread(analyze_stem, stem_pcm, master_pcm, category, sections)
    alignment = analysis.get("alignment") if isinstance(analysis.get("alignment"), dict) else {}
    technical = analysis.get("technical") if isinstance(analysis.get("technical"), dict) else {}
    return {
        "stem_analysis": analysis,
        "source_stem_sha256": stem_source_sha,
        "analysis_pcm_sha256": stem_pcm_sha,
        "offset_ms": int(alignment.get("offset_ms") or 0),
        "alignment_confidence": float(alignment.get("confidence") or 0.0),
        "duration_ms": int(technical.get("duration_ms") or 0) or None,
        "sample_rate": int(technical.get("source_sample_rate") or 0) or None,
        "channels": int(technical.get("source_channels") or 0) or None,
    }


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
    target_duration_ms = int(payload.get("duration_ms") or sum(int(clip.get("duration_ms") or 0) for clip in clips))
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


async def _decode_scene_layer(source: Path, target: Path, source_start_ms: int, duration_ms: int) -> None:
    args: list[str] = []
    if source_start_ms > 0:
        args.extend(["-ss", f"{source_start_ms / 1000.0:.6f}"])
    args.extend([
        "-i",
        str(source),
        "-vn",
        "-t",
        f"{duration_ms / 1000.0:.6f}",
        "-ac",
        "2",
        "-ar",
        str(AUDIO_SCENE_SR),
        "-c:a",
        "pcm_f32le",
        str(target),
    ])
    await ffmpeg(*args)


def _fade_curve(length: int, fade_in_samples: int, fade_out_samples: int) -> np.ndarray:
    curve = np.ones(length, dtype=np.float32)
    if fade_in_samples > 0:
        amount = min(length, fade_in_samples)
        curve[:amount] *= np.linspace(0.0, 1.0, amount, dtype=np.float32)
    if fade_out_samples > 0:
        amount = min(length, fade_out_samples)
        curve[-amount:] *= np.linspace(1.0, 0.0, amount, dtype=np.float32)
    return curve


async def render_audio_scene_job(payload: dict[str, Any], workdir: Path) -> dict[str, Any]:
    layers = payload.get("layers")
    upload_url = str(payload.get("upload_url") or "")
    clip_start_ms = max(0, int(payload.get("clip_start_ms") or 0))
    clip_end_ms = int(payload.get("clip_end_ms") or 0)
    if not isinstance(layers, list) or not layers:
        raise ValueError("Audio Scene layers are required")
    if not upload_url:
        raise ValueError("upload_url is required")
    if clip_end_ms <= clip_start_ms:
        raise ValueError("Audio Scene clip range is invalid")
    validate_remote_url(upload_url)

    duration_ms = min(120000, clip_end_ms - clip_start_ms)
    total_samples = int(math.ceil(duration_ms * AUDIO_SCENE_SR / 1000.0))
    mix = np.zeros((total_samples, 2), dtype=np.float32)

    for index, layer in enumerate(layers[:24]):
        if not isinstance(layer, dict):
            continue
        url = str(layer.get("url") or "")
        if not url:
            continue
        gain_db = float(layer.get("gain_db") or 0.0)
        source_offset_ms = int(layer.get("source_offset_ms") or 0)
        layer_start_ms = max(0, int(layer.get("start_at_ms") or 0))
        layer_end_ms = int(layer.get("end_at_ms") or duration_ms)
        layer_end_ms = max(layer_start_ms, min(duration_ms, layer_end_ms))
        if layer_end_ms <= layer_start_ms:
            continue

        source_time_at_layer_start = clip_start_ms + layer_start_ms - source_offset_ms
        source_start_ms = max(0, source_time_at_layer_start)
        alignment_delay_ms = max(0, -source_time_at_layer_start)
        effective_start_ms = layer_start_ms + alignment_delay_ms
        if effective_start_ms >= layer_end_ms:
            continue
        requested_ms = max(1, layer_end_ms - effective_start_ms)
        source = workdir / f"scene-layer-{index:02d}.source"
        decoded = workdir / f"scene-layer-{index:02d}.wav"
        await download(url, source)
        await _decode_scene_layer(source, decoded, source_start_ms, requested_ms)
        audio, sr = sf.read(decoded, always_2d=True, dtype="float32")
        if sr != AUDIO_SCENE_SR:
            raise RuntimeError("Scene decoder returned an unexpected sample rate")
        if audio.shape[1] == 1:
            audio = np.repeat(audio, 2, axis=1)
        elif audio.shape[1] > 2:
            audio = audio[:, :2]

        start_sample = int(round(effective_start_ms * AUDIO_SCENE_SR / 1000.0))
        max_length = min(len(audio), total_samples - start_sample)
        if max_length <= 0:
            continue
        audio = audio[:max_length]
        fade_in = int(max(0, int(layer.get("fade_in_ms") or 0)) * AUDIO_SCENE_SR / 1000.0)
        fade_out = int(max(0, int(layer.get("fade_out_ms") or 0)) * AUDIO_SCENE_SR / 1000.0)
        curve = _fade_curve(max_length, fade_in, fade_out)
        gain = float(10.0 ** (gain_db / 20.0))
        mix[start_sample:start_sample + max_length] += audio * curve[:, None] * gain

    peak = float(np.max(np.abs(mix))) if mix.size else 0.0
    ceiling = float(10.0 ** (-1.0 / 20.0))
    gain_reduction_db = 0.0
    if peak > ceiling and peak > 1e-9:
        scale = ceiling / peak
        mix *= scale
        gain_reduction_db = 20.0 * math.log10(scale)

    wav_output = workdir / "audio-scene.wav"
    mp3_output = workdir / "audio-scene.mp3"
    sf.write(wav_output, mix, AUDIO_SCENE_SR, subtype="PCM_24")
    await ffmpeg(
        "-i",
        str(wav_output),
        "-c:a",
        "libmp3lame",
        "-b:a",
        "320k",
        "-ar",
        str(AUDIO_SCENE_SR),
        str(mp3_output),
    )
    await upload_file(upload_url, mp3_output, "audio/mpeg")
    return {
        "uploaded": True,
        "file_size": mp3_output.stat().st_size,
        "mime_type": "audio/mpeg",
        "duration_ms": duration_ms,
        "sample_rate": AUDIO_SCENE_SR,
        "layer_count": len(layers),
        "peak_before_limiter": peak,
        "gain_reduction_db": gain_reduction_db,
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
    raise RuntimeError(f"Atlas callback could not be delivered after retries: {last_error}")


async def execute(request: WorkerRequest) -> str:
    await callback(request, "running")
    try:
        with tempfile.TemporaryDirectory(prefix="atlas-media-") as directory:
            workdir = Path(directory)
            if request.job_type == "analyze_audio":
                result = await analyze_job(request.payload, workdir)
            elif request.job_type == "analyze_stem":
                result = await analyze_stem_job(request.payload, workdir)
            elif request.job_type == "extract_frame":
                result = await extract_frame_job(request.payload, workdir)
            elif request.job_type == "render_audio_scene":
                result = await render_audio_scene_job(request.payload, workdir)
            elif request.job_type in {"render_master", "render_social", "render_promo", "render_hook"}:
                result = await render_job(request.payload, workdir)
            else:
                raise ValueError(f"Unsupported worker job type: {request.job_type}")
    except Exception as exc:
        await callback(request, "failed", error=str(exc)[:4000])
        return "failed"

    await callback(request, "completed", result=result)
    return "completed"
