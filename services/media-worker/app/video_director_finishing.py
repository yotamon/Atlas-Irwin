from __future__ import annotations

from pathlib import Path
from typing import Any, Awaitable, Callable


def _clamp(value: Any, low: float = 0.0, high: float = 1.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return low
    return max(low, min(high, number))


def _escape_drawtext(value: str) -> str:
    # drawtext has its own parser even when FFmpeg receives argv directly.
    return (
        value.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "\\%")
        .replace("\n", " ")
        .replace("\r", " ")
    )[:600]


def _base_filter(width: int, height: int, fps: int, focus_x: float) -> str:
    focus = _clamp(focus_x)
    return (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height}:x=(iw-ow)*{focus:.4f}:y=(ih-oh)/2,"
        f"fps={fps},setsar=1,format=yuv420p"
    )


def _reactive_filters(events: list[dict[str, Any]]) -> list[str]:
    filters: list[str] = []
    for event in events[:56]:
        start = max(0.0, float(event.get("start_ms") or 0) / 1000.0)
        end = max(start + 0.04, float(event.get("end_ms") or 0) / 1000.0)
        intensity = _clamp(event.get("intensity"))
        if intensity < 0.12:
            continue
        source = str(event.get("source") or "energy")
        contrast = 1.0 + 0.09 * intensity
        saturation = 1.0 + (0.13 if source in {"drums", "percussion", "energy"} else 0.08) * intensity
        brightness = 0.012 * intensity if source in {"drums", "percussion"} else 0.0
        filters.append(
            "eq="
            f"contrast={contrast:.4f}:saturation={saturation:.4f}:brightness={brightness:.4f}:"
            f"enable='between(t,{start:.4f},{end:.4f})'"
        )
    return filters


def _caption_filter(cue: dict[str, Any], width: int, height: int) -> str | None:
    text = str(cue.get("text") or "").strip()
    if not text:
        return None
    style = str(cue.get("style") or "clean")
    start = max(0.0, float(cue.get("start_ms") or 0) / 1000.0)
    end = max(start + 0.04, float(cue.get("end_ms") or 0) / 1000.0)
    safe = _escape_drawtext(text)
    if style == "poster":
        font_size = max(28, round(min(width, height) * 0.064))
        x = "(w-text_w)/2"
        y = "(h-text_h)/2"
        box = "box=1:boxcolor=black@0.52:boxborderw=18"
    elif style == "editorial":
        font_size = max(24, round(min(width, height) * 0.045))
        x = "w*0.07"
        y = "h*0.12"
        box = "box=1:boxcolor=black@0.38:boxborderw=12"
    elif style == "karaoke":
        font_size = max(26, round(min(width, height) * 0.052))
        x = "(w-text_w)/2"
        y = "h*0.80"
        box = "box=1:boxcolor=black@0.48:boxborderw=14"
    else:
        font_size = max(24, round(min(width, height) * 0.044))
        x = "(w-text_w)/2"
        y = "h*0.82"
        box = "box=1:boxcolor=black@0.42:boxborderw=12"
    return (
        f"drawtext=text='{safe}':fontcolor=white:fontsize={font_size}:"
        f"x={x}:y={y}:{box}:"
        f"enable='between(t,{start:.4f},{end:.4f})'"
    )


def build_video_director_filter(
    width: int,
    height: int,
    fps: int,
    focus_x: float,
    clip: dict[str, Any],
) -> tuple[str, dict[str, Any]]:
    chain = [_base_filter(width, height, fps, focus_x)]
    raw_events = clip.get("reactive_events")
    events = [event for event in raw_events if isinstance(event, dict)] if isinstance(raw_events, list) else []
    reactive = _reactive_filters(events)
    chain.extend(reactive)

    raw_captions = clip.get("captions")
    captions = [cue for cue in raw_captions if isinstance(cue, dict)] if isinstance(raw_captions, list) else []
    caption_filters = [candidate for cue in captions if (candidate := _caption_filter(cue, width, height))]
    chain.extend(caption_filters)
    return ",".join(chain), {
        "reactive_event_count": len(reactive),
        "caption_count": len(caption_filters),
        "qc_policy": clip.get("qc_policy") if isinstance(clip.get("qc_policy"), dict) else {},
    }


def default_review_frame_timestamps(duration_ms: int) -> list[int]:
    if duration_ms <= 0:
        return []
    ratios = (0.04, 0.22, 0.5, 0.76, 0.96)
    return sorted({max(0, min(duration_ms - 80, round(duration_ms * ratio))) for ratio in ratios})


async def extract_review_frames(
    output: Path,
    review_frames: list[dict[str, Any]],
    workdir: Path,
    ffmpeg: Callable[..., Awaitable[None]],
    upload_file: Callable[[str, Path, str], Awaitable[None]],
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for index, frame in enumerate(review_frames[:6]):
        upload_url = str(frame.get("upload_url") or "")
        public_url = str(frame.get("public_url") or "")
        timestamp_ms = max(0, int(frame.get("timestamp_ms") or 0))
        if not upload_url or not public_url:
            continue
        target = workdir / f"review-frame-{index + 1:02d}.jpg"
        await ffmpeg(
            "-ss", f"{timestamp_ms / 1000.0:.3f}",
            "-i", str(output),
            "-frames:v", "1",
            "-vf", "scale=w='min(1600,iw)':h=-2",
            "-q:v", "2",
            str(target),
        )
        if not target.exists() or target.stat().st_size <= 0:
            raise RuntimeError("Video Director temporal QC frame extraction produced no image")
        await upload_file(upload_url, target, "image/jpeg")
        results.append({
            "timestamp_ms": timestamp_ms,
            "public_url": public_url,
            "file_size": target.stat().st_size,
        })
    return results
