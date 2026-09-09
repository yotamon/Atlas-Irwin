from __future__ import annotations

import hashlib
import json
import math
from typing import Any

MIXPLAN_VERSION = "ensemblis.mixplan.v2"
ALLOWED_TECHNIQUES = {
    "quick_mix",
    "bass_swap",
    "harmonic_blend",
    "breakdown_swap",
    "echo_out",
    "drop_cut",
}


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _records(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _automation_for_transition(transition: dict[str, Any]) -> dict[str, Any]:
    technique = str(transition.get("technique") or "drop_cut")
    overlap_ms = max(0, int(transition.get("overlap_ms") or 0))
    duration = max(1, overlap_ms)
    if overlap_ms <= 0:
        return {
            "duration_ms": 0,
            "from_gain": [{"at": 0.0, "value": 1.0}, {"at": 1.0, "value": 0.0}],
            "to_gain": [{"at": 0.0, "value": 0.0}, {"at": 1.0, "value": 1.0}],
            "low_end_handoff": None,
            "fx": None,
        }

    low_end = None
    if technique in {"bass_swap", "harmonic_blend", "breakdown_swap", "quick_mix"}:
        if technique == "harmonic_blend":
            low_end = {"from_zero_at": 0.68, "to_full_from": 0.32}
        else:
            low_end = {"from_zero_at": 0.58, "to_full_from": 0.42}
    fx = {"kind": "echo_out", "tail_ms": duration} if technique == "echo_out" else None
    return {
        "duration_ms": overlap_ms,
        "from_gain": [{"at": 0.0, "value": 1.0}, {"at": 1.0, "value": 0.0}],
        "to_gain": [{"at": 0.0, "value": 0.0}, {"at": 1.0, "value": 1.0}],
        "low_end_handoff": low_end,
        "fx": fx,
    }


def build_mixplan(plan: dict[str, Any], *, source_fingerprints: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    tracks = []
    for item in _records(plan.get("tracks")):
        tracks.append({
            **item,
            "source": {
                "start_ms": int(item.get("source_start_ms") or 0),
                "end_ms": int(item.get("source_end_ms") or 0),
            },
            "playback": {
                "bpm": float(item.get("playback_bpm") or item.get("dj_bpm") or item.get("source_bpm") or 120.0),
                "time_factor": float(item.get("time_factor") or 1.0),
                "pitch_shift_semitones": 0.0,
            },
        })

    transitions = []
    for index, item in enumerate(_records(plan.get("transitions"))):
        fallback = _record(item.get("fallback"))
        if not fallback:
            fallback = {
                "technique": "quick_mix" if bool(item.get("beatmatch")) else "drop_cut",
                "bars": 4 if bool(item.get("beatmatch")) else 0,
            }
        transitions.append({
            **item,
            "index": index,
            "automation": _automation_for_transition(item),
            "fallback": fallback,
        })

    result = {
        "version": MIXPLAN_VERSION,
        "planner_version": str(plan.get("version") or "unknown"),
        "execution_contract": "offline_audio_render",
        "purpose": plan.get("purpose"),
        "energy_profile": plan.get("energy_profile"),
        "transition_style": plan.get("transition_style"),
        "requested_duration_ms": int(plan.get("requested_duration_ms") or 0),
        "estimated_duration_ms": int(plan.get("estimated_duration_ms") or 0),
        "tracks": tracks,
        "transitions": transitions,
        "quality_contract": _record(plan.get("quality_contract")),
        "quality_summary": _record(plan.get("quality_summary")),
        "provenance": {
            "source_fingerprints": source_fingerprints or [],
        },
    }
    validate_mixplan(result)
    result["plan_hash"] = mixplan_hash(result)
    return result


def _validate_envelope(name: str, value: Any, *, allow_none: bool = False) -> None:
    if value is None and allow_none:
        return
    points = _records(value)
    if len(points) < 2:
        raise ValueError(f"MixPlan {name} requires at least two automation points")
    previous = -1.0
    for point in points:
        at = point.get("at")
        amount = point.get("value")
        if not _finite(at) or not 0.0 <= float(at) <= 1.0:
            raise ValueError(f"MixPlan {name} automation position must be within 0..1")
        if float(at) < previous:
            raise ValueError(f"MixPlan {name} automation points must be ordered")
        if not _finite(amount) or not 0.0 <= float(amount) <= 1.25:
            raise ValueError(f"MixPlan {name} automation value must be within 0..1.25")
        previous = float(at)


def validate_mixplan(manifest: dict[str, Any]) -> None:
    if str(manifest.get("version") or "") != MIXPLAN_VERSION:
        raise ValueError(f"Unsupported MixPlan version: {manifest.get('version')!r}")
    tracks = _records(manifest.get("tracks"))
    transitions = _records(manifest.get("transitions"))
    if not tracks:
        raise ValueError("MixPlan contains no tracks")
    if len(transitions) != max(0, len(tracks) - 1):
        raise ValueError("MixPlan must contain exactly one transition between adjacent tracks")

    seen: set[str] = set()
    for index, item in enumerate(tracks):
        track_id = str(item.get("track_id") or "")
        if not track_id or track_id in seen:
            raise ValueError("MixPlan track IDs must be non-empty and unique")
        seen.add(track_id)
        source = _record(item.get("source"))
        start = source.get("start_ms")
        end = source.get("end_ms")
        if not _finite(start) or not _finite(end) or int(start) < 0 or int(end) <= int(start):
            raise ValueError(f"MixPlan track {track_id} has an invalid source window")
        playback = _record(item.get("playback"))
        factor = playback.get("time_factor")
        if not _finite(factor) or not 0.94 <= float(factor) <= 1.06:
            raise ValueError(f"MixPlan track {track_id} violates the ±6% playback-rate contract")
        pitch = playback.get("pitch_shift_semitones", 0.0)
        if not _finite(pitch) or abs(float(pitch)) > 1e-9:
            raise ValueError("MixPlan pitch shifting is not permitted")
        bpm = playback.get("bpm")
        if not _finite(bpm) or float(bpm) <= 0:
            raise ValueError(f"MixPlan track {track_id} has invalid playback BPM")
        if index and tracks[index - 1].get("track_id") == track_id:
            raise ValueError("MixPlan cannot repeat the same adjacent track")

    for index, transition in enumerate(transitions):
        left = str(tracks[index].get("track_id"))
        right = str(tracks[index + 1].get("track_id"))
        if str(transition.get("from_track_id") or "") != left or str(transition.get("to_track_id") or "") != right:
            raise ValueError("MixPlan transition endpoints must match adjacent track order")
        technique = str(transition.get("technique") or "")
        if technique not in ALLOWED_TECHNIQUES:
            raise ValueError(f"MixPlan transition uses unsupported technique {technique!r}")
        overlap = transition.get("overlap_ms", 0)
        if not _finite(overlap) or int(overlap) < 0:
            raise ValueError("MixPlan transition overlap must be non-negative")
        left_window = int(_record(tracks[index].get("source"))["end_ms"]) - int(_record(tracks[index].get("source"))["start_ms"])
        right_window = int(_record(tracks[index + 1].get("source"))["end_ms"]) - int(_record(tracks[index + 1].get("source"))["start_ms"])
        if int(overlap) > min(left_window, right_window) * 0.45 + 1:
            raise ValueError("MixPlan transition overlap exceeds the safe source-window budget")
        automation = _record(transition.get("automation"))
        if int(automation.get("duration_ms") or 0) != int(overlap):
            raise ValueError("MixPlan transition automation duration must equal overlap")
        _validate_envelope("from_gain", automation.get("from_gain"))
        _validate_envelope("to_gain", automation.get("to_gain"))
        confidence = transition.get("confidence", 0.5)
        if not _finite(confidence) or not 0.0 <= float(confidence) <= 1.0:
            raise ValueError("MixPlan transition confidence must be within 0..1")
        fallback = _record(transition.get("fallback"))
        fallback_technique = str(fallback.get("technique") or "")
        if fallback_technique not in ALLOWED_TECHNIQUES:
            raise ValueError("MixPlan fallback technique is invalid")


def mixplan_hash(manifest: dict[str, Any]) -> str:
    canonical = dict(manifest)
    canonical.pop("plan_hash", None)
    payload = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
