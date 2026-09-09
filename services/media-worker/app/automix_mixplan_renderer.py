from __future__ import annotations

from pathlib import Path
from typing import Any

from .automix_dsp import render_plan as _render_legacy_plan
from .automix_manifest import MIXPLAN_VERSION, mixplan_hash, validate_mixplan
from .automix_model import TrackDescriptor


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _records(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _legacy_render_view(manifest: dict[str, Any]) -> dict[str, Any]:
    """Create the narrow compatibility view consumed by the current DSP implementation.

    MixPlan is the public render contract from v2 onward. Keeping this adapter isolated means
    the deterministic DSP can evolve without allowing planner dictionaries to bypass manifest
    validation. A future local renderer can consume the same manifest directly.
    """
    tracks: list[dict[str, Any]] = []
    for item in _records(manifest.get("tracks")):
        source = _record(item.get("source"))
        playback = _record(item.get("playback"))
        tracks.append({
            **item,
            "source_start_ms": int(source["start_ms"]),
            "source_end_ms": int(source["end_ms"]),
            "playback_bpm": float(playback["bpm"]),
            "time_factor": float(playback["time_factor"]),
        })
    transitions = [{**item} for item in _records(manifest.get("transitions"))]
    return {
        "version": manifest.get("planner_version"),
        "purpose": manifest.get("purpose"),
        "energy_profile": manifest.get("energy_profile"),
        "transition_style": manifest.get("transition_style"),
        "requested_duration_ms": manifest.get("requested_duration_ms"),
        "estimated_duration_ms": manifest.get("estimated_duration_ms"),
        "tracks": tracks,
        "transitions": transitions,
        "quality_contract": _record(manifest.get("quality_contract")),
        "quality_summary": _record(manifest.get("quality_summary")),
    }


def render_mixplan(
    tracks: list[TrackDescriptor],
    manifest: dict[str, Any],
    workdir: Path,
) -> tuple[Path, dict[str, Any]]:
    validate_mixplan(manifest)
    expected_hash = str(manifest.get("plan_hash") or "")
    actual_hash = mixplan_hash(manifest)
    if expected_hash and expected_hash != actual_hash:
        raise ValueError("MixPlan hash does not match its canonical render instructions")

    manifest_ids = [str(item.get("track_id") or "") for item in _records(manifest.get("tracks"))]
    available_ids = {track.id for track in tracks}
    if any(track_id not in available_ids for track_id in manifest_ids):
        raise ValueError("MixPlan references a source track that is unavailable to this renderer")

    output, metadata = _render_legacy_plan(tracks, _legacy_render_view(manifest), workdir)
    return output, {
        **metadata,
        "mixplan_version": MIXPLAN_VERSION,
        "mixplan_hash": actual_hash,
        "render_contract": "validated_mixplan_only",
    }
