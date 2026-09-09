from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from . import main as worker_main
from .automix import _upload_streaming, prepare_tracks
from .automix_manifest import MIXPLAN_VERSION, mixplan_hash, validate_mixplan
from .automix_mixplan_renderer import render_mixplan


class AutomixPreviewWorkerRequest(BaseModel):
    job_id: str
    job_type: Literal["render_automix_preview"]
    payload: dict[str, Any] = Field(default_factory=dict)
    callback_url: str
    callback_token: str


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _records(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _verified_manifest(value: Any) -> dict[str, Any]:
    manifest = _record(value)
    validate_mixplan(manifest)
    expected = str(manifest.get("plan_hash") or "")
    actual = mixplan_hash(manifest)
    if not expected or expected != actual:
        raise ValueError("Transition preview requires an intact verified MixPlan hash")
    return manifest


def _submanifest(manifest: dict[str, Any], transition_index: int) -> dict[str, Any]:
    tracks = _records(manifest.get("tracks"))
    transitions = _records(manifest.get("transitions"))
    if transition_index < 0 or transition_index >= len(transitions):
        raise ValueError("Transition preview index is outside the verified MixPlan")
    left = dict(tracks[transition_index])
    right = dict(tracks[transition_index + 1])
    transition = {**transitions[transition_index], "index": 0}
    overlap = max(0, int(transition.get("overlap_ms") or 0))

    def rendered_ms(item: dict[str, Any]) -> int:
        source = _record(item.get("source"))
        playback = _record(item.get("playback"))
        window = max(0, int(source.get("end_ms") or 0) - int(source.get("start_ms") or 0))
        factor = float(playback.get("time_factor") or 1.0)
        return int(round(window / max(1e-6, factor)))

    result = {
        "version": MIXPLAN_VERSION,
        "planner_version": manifest.get("planner_version"),
        "execution_contract": "offline_audio_render",
        "purpose": manifest.get("purpose"),
        "energy_profile": manifest.get("energy_profile"),
        "transition_style": manifest.get("transition_style"),
        "requested_duration_ms": rendered_ms(left) + rendered_ms(right) - overlap,
        "estimated_duration_ms": rendered_ms(left) + rendered_ms(right) - overlap,
        "tracks": [left, right],
        "transitions": [transition],
        "quality_contract": _record(manifest.get("quality_contract")),
        "quality_summary": {
            "transition_count": 1,
            "mean_score": transition.get("score"),
            "mean_confidence": transition.get("confidence"),
            "minimum_confidence": transition.get("confidence"),
            "risky_transition_count": 1 if transition.get("risk_flags") else 0,
            "risk_flags": {},
        },
        "provenance": {
            **_record(manifest.get("provenance")),
            "preview_parent_plan_hash": manifest.get("plan_hash"),
            "preview_transition_index": transition_index,
        },
    }
    validate_mixplan(result)
    result["plan_hash"] = mixplan_hash(result)
    return result


async def automix_preview_job(payload: dict[str, Any], workdir: Path) -> dict[str, Any]:
    raw_tracks = _records(payload.get("tracks"))
    manifest = _verified_manifest(payload.get("mixplan"))
    transition_index = int(payload.get("transition_index") or 0)
    preview_manifest = _submanifest(manifest, transition_index)
    preview_ids = [str(item.get("track_id") or "") for item in _records(preview_manifest.get("tracks"))]
    raw_by_id = {str(item.get("id") or ""): item for item in raw_tracks}
    selected_raw = [raw_by_id[track_id] for track_id in preview_ids if track_id in raw_by_id]
    if len(selected_raw) != 2:
        raise ValueError("Transition preview source tracks do not match the verified MixPlan")

    purpose = str(manifest.get("purpose") or "booking")
    prepared = await prepare_tracks(selected_raw, workdir, purpose, 4 * 60 * 1000)  # type: ignore[arg-type]
    rendered_path, render_meta = await asyncio.to_thread(render_mixplan, prepared, preview_manifest, workdir)
    timeline = _records(render_meta.get("transition_timeline"))
    if not timeline:
        raise ValueError("Transition preview renderer did not produce transition timing")
    transition_meta = timeline[0]
    transition_start_ms = max(0, int(transition_meta.get("timeline_start_ms") or 0))
    overlap_ms = max(0, int(transition_meta.get("rendered_overlap_ms") or 0))
    full_duration_ms = max(0, int(render_meta.get("duration_ms") or 0))
    preview_start_ms = max(0, transition_start_ms - 8_000)
    preview_end_ms = min(full_duration_ms, transition_start_ms + max(overlap_ms, 4_000) + 8_000)
    if preview_end_ms - preview_start_ms < 8_000:
        preview_end_ms = min(full_duration_ms, preview_start_ms + 8_000)
    preview_duration_ms = max(1_000, preview_end_ms - preview_start_ms)

    output_path = workdir / "automix-transition-preview.mp3"
    await worker_main.ffmpeg(
        "-i", str(rendered_path),
        "-ss", f"{preview_start_ms / 1000.0:.3f}",
        "-t", f"{preview_duration_ms / 1000.0:.3f}",
        "-vn", "-c:a", "libmp3lame", "-b:a", "192k",
        str(output_path),
    )
    upload_url = str(payload.get("upload_url") or "")
    if not upload_url:
        raise ValueError("Transition preview upload_url is required")
    await _upload_streaming(upload_url, output_path, "audio/mpeg")
    sha256 = await asyncio.to_thread(worker_main.sha256_file, output_path)
    transition = _records(preview_manifest.get("transitions"))[0]
    return {
        "uploaded": True,
        "file_size": output_path.stat().st_size,
        "mime_type": "audio/mpeg",
        "sha256": sha256,
        "transition_index": transition_index,
        "transition": {
            "from_track_id": transition.get("from_track_id"),
            "to_track_id": transition.get("to_track_id"),
            "technique": transition.get("technique"),
            "confidence": transition.get("confidence"),
            "risk_flags": transition.get("risk_flags") or [],
            "rendered_overlap_ms": overlap_ms,
        },
        "preview": {
            "start_ms": preview_start_ms,
            "duration_ms": preview_duration_ms,
        },
        "parent_mixplan_hash": manifest.get("plan_hash"),
        "preview_mixplan_hash": preview_manifest.get("plan_hash"),
        "engine": {
            "mixplan_version": MIXPLAN_VERSION,
            "render_contract": "canonical_two_track_mixplan_then_crop",
            "source_mutation": False,
        },
    }


async def execute_automix_preview(request: AutomixPreviewWorkerRequest) -> str:
    await worker_main.callback(request, "running", result={"phase": "rendering_transition_preview"})  # type: ignore[arg-type]
    try:
        with tempfile.TemporaryDirectory(prefix="ensemblis-automix-preview-") as directory:
            result = await automix_preview_job(request.payload, Path(directory))
    except Exception as exc:
        await worker_main.callback(request, "failed", error=str(exc)[:4000])  # type: ignore[arg-type]
        return "failed"
    await worker_main.callback(request, "completed", result=result)  # type: ignore[arg-type]
    return "completed"
