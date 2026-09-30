from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

from .main import download, ffmpeg, sha256_file, upload_file, validate_remote_url


class FreeComposerWorkerRequest(BaseModel):
    job_id: str
    job_type: Literal["compose_free_social_asset"]
    payload: dict[str, Any] = Field(default_factory=dict)
    callback_url: str
    callback_token: str


_TEMPLATES = frozenset({
    "deep_zoom",
    "slow_drift",
    "glass_echo",
    "mono_pulse",
    "warm_bloom",
    "club_flash",
    "soft_focus",
    "minimal_frame",
})


def _template_filter(template: str) -> str:
    base = (
        "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,boxblur=28:2[bg];"
        "[0:v]scale=900:900:force_original_aspect_ratio=decrease[cover]"
    )
    if template == "deep_zoom":
        return f"{base};[bg][cover]overlay=(W-w)/2:(H-h)/2,zoompan=z='min(zoom+0.0007,1.08)':d=1:s=1080x1920:fps=30,format=yuv420p[v]"
    if template == "slow_drift":
        return f"{base};[bg][cover]overlay='(W-w)/2+18*sin(t/2.5)':'(H-h)/2+12*cos(t/3)',eq=saturation=1.08:contrast=1.03,format=yuv420p[v]"
    if template == "glass_echo":
        return f"{base};[bg]eq=saturation=1.25:contrast=1.04[bg2];[cover]split=2[c1][c2];[c2]scale=940:940,boxblur=18:3,colorchannelmixer=aa=0.28[echo];[bg2][echo]overlay=(W-w)/2:(H-h)/2[stage];[stage][c1]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]"
    if template == "mono_pulse":
        return f"{base};[cover]eq=saturation=0.15:contrast=1.16[mono];[bg][mono]overlay=(W-w)/2:(H-h)/2,eq=brightness='0.02*sin(2*PI*t/2)':eval=frame,format=yuv420p[v]"
    if template == "warm_bloom":
        return f"{base};[bg]colorbalance=rs=.08:gs=.02:bs=-.04[bg2];[cover]eq=saturation=1.12:brightness=0.02[art];[bg2][art]overlay=(W-w)/2:(H-h)/2,vignette=PI/5,format=yuv420p[v]"
    if template == "club_flash":
        return f"{base};[bg][cover]overlay=(W-w)/2:(H-h)/2,eq=brightness='if(lt(mod(t,2),0.08),0.08,0)':eval=frame:saturation=1.15,format=yuv420p[v]"
    if template == "soft_focus":
        return f"{base};[bg]gblur=sigma=18[bg2];[cover]eq=saturation=.92:contrast=.98[art];[bg2][art]overlay=(W-w)/2:(H-h)/2,vignette=PI/4,format=yuv420p[v]"
    return f"{base};[bg][cover]overlay=(W-w)/2:(H-h)/2,drawbox=x=74:y=434:w=932:h=932:color=white@0.16:t=2,format=yuv420p[v]"


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


async def compose_free_social_asset(payload: dict[str, Any], directory: Path) -> dict[str, Any]:
    artwork_url = str(payload.get("artwork_url") or "")
    audio_url = str(payload.get("audio_url") or "")
    upload_url = str(payload.get("upload_url") or "")
    public_url = str(payload.get("public_url") or "")
    template = str(payload.get("template") or "minimal_frame")
    if template not in _TEMPLATES:
        raise ValueError(f"Unsupported free composer template: {template}")
    for value in (artwork_url, audio_url, upload_url, public_url):
        validate_remote_url(value)

    artwork = directory / "artwork"
    audio = directory / "audio"
    output = directory / "output.mp4"
    await asyncio.gather(download(artwork_url, artwork), download(audio_url, audio))

    start_seconds = max(0.0, _number(payload.get("audio_start_ms")) / 1000.0)
    duration_ms = 15_000
    await ffmpeg(
        "-loop", "1",
        "-framerate", "30",
        "-i", str(artwork),
        "-ss", f"{start_seconds:.3f}",
        "-i", str(audio),
        "-t", "15",
        "-filter_complex", _template_filter(template),
        "-map", "[v]",
        "-map", "1:a:0",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "21",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest",
        str(output),
    )
    await upload_file(upload_url, output, "video/mp4")
    return {
        "uploaded": True,
        "public_url": public_url,
        "mime_type": "video/mp4",
        "file_size": output.stat().st_size,
        "sha256": sha256_file(output),
        "width": 1080,
        "height": 1920,
        "duration_ms": duration_ms,
        "template": template,
    }


async def _callback(
    request: FreeComposerWorkerRequest,
    status: str,
    result: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    validate_remote_url(request.callback_url)
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
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
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                await asyncio.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Free Content Factory callback could not be delivered after retries: {last_error}")


async def execute_free_composer(request: FreeComposerWorkerRequest) -> str:
    await _callback(request, "running")
    try:
        with tempfile.TemporaryDirectory(prefix="ensemblis-free-composer-") as directory:
            result = await compose_free_social_asset(request.payload, Path(directory))
    except Exception as exc:
        await _callback(request, "failed", error=str(exc)[:4000])
        return "failed"
    await _callback(request, "completed", result=result)
    return "completed"
