from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

# The packaging workflow adds services/media-worker to the import path so this sidecar imports the
# exact same MixPlan validator, TrackDescriptor model and DSP renderer used by the cloud worker.
from app.automix_manifest import mixplan_hash, validate_mixplan
from app.automix_mixplan_renderer import render_mixplan
from app.automix_model import MusicalKey, TrackDescriptor

PROTOCOL_VERSION = "ensemblis.library-bridge.renderer.v1"
MAX_REQUEST_BYTES = 16 * 1024 * 1024


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def _track(raw: dict[str, Any]) -> TrackDescriptor:
    path = Path(str(raw.get("path") or ""))
    if not path.is_file():
        raise ValueError("local renderer source is unavailable")
    key_raw = _record(raw.get("key"))
    mode = str(key_raw.get("mode") or "major")
    if mode not in {"major", "minor"}:
        raise ValueError("local renderer track key mode is invalid")
    key = MusicalKey(
        root_pc=int(key_raw.get("rootPc") or 0),
        mode=mode,  # type: ignore[arg-type]
        confidence=max(0.0, min(1.0, _finite(key_raw.get("confidence"), 0.0))),
        camelot=str(key_raw.get("camelot") or "8B"),
        label=str(key_raw.get("label") or "C major"),
    )
    return TrackDescriptor(
        id=str(raw.get("trackId") or ""),
        title=str(raw.get("title") or "Untitled"),
        url="device-local://verified",
        path=path,
        music_map=_record(raw.get("musicMap")),
        duration_ms=max(0, int(raw.get("durationMs") or 0)),
        bpm=max(1.0, _finite(raw.get("bpm"), 120.0)),
        dj_bpm=max(1.0, _finite(raw.get("djBpm"), 120.0)),
        key=key,
        energy=max(0.0, min(1.0, _finite(raw.get("energy"), 0.5))),
        loudness_lufs=_finite(raw.get("loudnessLufs")) if raw.get("loudnessLufs") is not None else None,
        window_start_ms=max(0, int(raw.get("windowStartMs") or 0)),
        window_end_ms=max(0, int(raw.get("windowEndMs") or 0)),
        window_score=max(0.0, min(1.0, _finite(raw.get("windowScore"), 0.5))),
    )


def _encode_mp3(wav_path: Path, target: Path, sample_rate: int) -> None:
    # imageio-ffmpeg is already a canonical media-worker dependency and supplies the same FFmpeg
    # family used by the cloud renderer. Import lazily so WAV-only execution has no codec dependency.
    import imageio_ffmpeg

    binary = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run(
        [
            binary,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(wav_path),
            "-c:a",
            "libmp3lame",
            "-b:a",
            "320k",
            "-ar",
            str(sample_rate),
            str(target),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def execute(request_path: Path, result_path: Path) -> None:
    if request_path.stat().st_size > MAX_REQUEST_BYTES:
        raise ValueError("local renderer request is too large")
    request = json.loads(request_path.read_text(encoding="utf-8"))
    if not isinstance(request, dict) or request.get("version") != PROTOCOL_VERSION:
        raise ValueError("unsupported local renderer protocol")

    mixplan = _record(request.get("mixPlan"))
    validate_mixplan(mixplan)
    plan_hash = str(mixplan.get("plan_hash") or "")
    if not plan_hash or mixplan_hash(mixplan) != plan_hash:
        raise ValueError("local renderer MixPlan hash mismatch")
    if str(request.get("planHash") or "") != plan_hash:
        raise ValueError("local renderer request does not match frozen MixPlan")

    raw_tracks = request.get("tracks")
    if not isinstance(raw_tracks, list) or len(raw_tracks) < 2 or len(raw_tracks) > 20:
        raise ValueError("local renderer requires 2-20 source tracks")
    tracks = [_track(item) for item in raw_tracks if isinstance(item, dict)]
    if len(tracks) != len(raw_tracks):
        raise ValueError("local renderer track descriptor is invalid")

    workdir = result_path.parent / "work"
    workdir.mkdir(parents=True, exist_ok=True)
    wav_path, render_meta = render_mixplan(tracks, mixplan, workdir)

    output_format = str(request.get("outputFormat") or "wav").lower()
    if output_format == "wav":
        output_path = result_path.parent / "mix.wav"
        shutil.copy2(wav_path, output_path)
        mime_type = "audio/wav"
    elif output_format == "mp3":
        output_path = result_path.parent / "mix.mp3"
        _encode_mp3(wav_path, output_path, int(render_meta.get("sample_rate") or 44100))
        mime_type = "audio/mpeg"
    else:
        raise ValueError("local renderer output format is invalid")

    result = {
        "version": PROTOCOL_VERSION,
        "status": "completed",
        "planHash": plan_hash,
        "outputFormat": output_format,
        "mimeType": mime_type,
        "outputPath": str(output_path),
        "sha256": _sha256(output_path),
        "fileSize": output_path.stat().st_size,
        "render": render_meta,
    }
    result_path.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Ensemblis canonical local MixPlan renderer")
    parser.add_argument("--request", required=True)
    parser.add_argument("--result", required=True)
    args = parser.parse_args()
    try:
        execute(Path(args.request), Path(args.result))
        return 0
    except Exception as exc:
        # Sidecar stderr remains device-local. The Rust boundary maps failures to path-free cloud errors.
        print(f"local renderer failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
