from __future__ import annotations

import hashlib
import json
import math
from typing import Any

MIXPLAN_VERSION = "ensemblis.mixplan.v2"
AUTOMATION_VERSION = "ensemblis.transition-automation.v1"
RENDER_ENGINE_CONTRACT_VERSION = "ensemblis.offline-audio-render.v1"
SUPPORTED_RENDER_ENGINE_CONTRACT_VERSIONS = {RENDER_ENGINE_CONTRACT_VERSION}
ALLOWED_TECHNIQUES = {
    "quick_mix", "bass_swap", "harmonic_blend", "breakdown_swap", "echo_out", "drop_cut",
}


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _records(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _equal_power_curves() -> tuple[list[dict[str, float]], list[dict[str, float]]]:
    return (
        [{"at": 0.0, "value": 1.0}, {"at": 0.5, "value": 0.7071}, {"at": 1.0, "value": 0.0}],
        [{"at": 0.0, "value": 0.0}, {"at": 0.5, "value": 0.7071}, {"at": 1.0, "value": 1.0}],
    )


def _automation_for_transition(transition: dict[str, Any]) -> dict[str, Any]:
    technique = str(transition.get("technique") or "drop_cut")
    overlap_ms = max(0, int(transition.get("overlap_ms") or 0))
    from_gain, to_gain = _equal_power_curves()
    if overlap_ms <= 0:
        return {
            "version": AUTOMATION_VERSION,
            "duration_ms": 0,
            "from_gain": from_gain,
            "to_gain": to_gain,
            "low_end_handoff": None,
            "fx": None,
            "stem_ducking": None,
        }

    low_end = None
    if technique in {"bass_swap", "harmonic_blend", "breakdown_swap", "quick_mix"}:
        if technique == "harmonic_blend":
            from_zero_at, to_full_from = 0.68, 0.32
        elif technique == "quick_mix":
            from_zero_at, to_full_from = 0.54, 0.46
        else:
            from_zero_at, to_full_from = 0.58, 0.42
        low_end = {
            "cutoff_hz": 180.0,
            "from_gain": [
                {"at": 0.0, "value": 1.0},
                {"at": from_zero_at, "value": 0.0},
                {"at": 1.0, "value": 0.0},
            ],
            "to_gain": [
                {"at": 0.0, "value": 0.0},
                {"at": to_full_from, "value": 0.0},
                {"at": 1.0, "value": 1.0},
            ],
        }
    fx = None
    if technique == "echo_out":
        fx = {"kind": "echo_out", "tail_ms": overlap_ms, "feedback": 0.48}
    return {
        "version": AUTOMATION_VERSION,
        "duration_ms": overlap_ms,
        "from_gain": from_gain,
        "to_gain": to_gain,
        "low_end_handoff": low_end,
        "fx": fx,
        "stem_ducking": None,
    }


def build_mixplan(plan: dict[str, Any], *, source_fingerprints: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    tracks = []
    for item in _records(plan.get("tracks")):
        tracks.append({
            **item,
            "source": {"start_ms": int(item.get("source_start_ms") or 0), "end_ms": int(item.get("source_end_ms") or 0)},
            "playback": {
                "bpm": float(item.get("playback_bpm") or item.get("dj_bpm") or item.get("source_bpm") or 120.0),
                "time_factor": float(item.get("time_factor") or 1.0),
                "pitch_shift_semitones": 0.0,
            },
        })
    transitions = []
    for index, item in enumerate(_records(plan.get("transitions"))):
        fallback = _record(item.get("fallback")) or {
            "technique": "quick_mix" if bool(item.get("beatmatch")) else "drop_cut",
            "bars": 4 if bool(item.get("beatmatch")) else 0,
        }
        transitions.append({**item, "index": index, "automation": _automation_for_transition(item), "fallback": fallback})
    result = {
        "version": MIXPLAN_VERSION,
        "planner_version": str(plan.get("version") or "unknown"),
        "execution_contract": "offline_audio_render",
        "render_engine_contract_version": RENDER_ENGINE_CONTRACT_VERSION,
        "purpose": plan.get("purpose"),
        "energy_profile": plan.get("energy_profile"),
        "transition_style": plan.get("transition_style"),
        "requested_duration_ms": int(plan.get("requested_duration_ms") or 0),
        "estimated_duration_ms": int(plan.get("estimated_duration_ms") or 0),
        "tracks": tracks,
        "transitions": transitions,
        "quality_contract": _record(plan.get("quality_contract")),
        "quality_summary": _record(plan.get("quality_summary")),
        "provenance": {"source_fingerprints": source_fingerprints or []},
    }
    validate_mixplan(result)
    result["plan_hash"] = mixplan_hash(result)
    return result


def _validate_envelope(name: str, value: Any) -> None:
    points = _records(value)
    if len(points) < 2:
        raise ValueError(f"MixPlan {name} requires at least two automation points")
    previous = -1.0
    for point in points:
        at, amount = point.get("at"), point.get("value")
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
    renderer_contract = manifest.get("render_engine_contract_version")
    # MixPlan v2 existed briefly before the renderer contract received its own version field.
    # Missing is accepted as the original v1 contract for reproducibility; unknown explicit
    # versions fail closed so a future renderer cannot accidentally execute incompatible DSP.
    if renderer_contract is not None and str(renderer_contract) not in SUPPORTED_RENDER_ENGINE_CONTRACT_VERSIONS:
        raise ValueError(f"Unsupported render engine contract: {renderer_contract!r}")
    tracks, transitions = _records(manifest.get("tracks")), _records(manifest.get("transitions"))
    if not tracks:
        raise ValueError("MixPlan contains no tracks")
    if len(transitions) != max(0, len(tracks) - 1):
        raise ValueError("MixPlan must contain exactly one transition between adjacent tracks")
    seen: set[str] = set()
    for item in tracks:
        track_id = str(item.get("track_id") or "")
        if not track_id or track_id in seen:
            raise ValueError("MixPlan track IDs must be non-empty and unique")
        seen.add(track_id)
        source = _record(item.get("source"))
        start, end = source.get("start_ms"), source.get("end_ms")
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
    for index, transition in enumerate(transitions):
        left, right = str(tracks[index].get("track_id")), str(tracks[index + 1].get("track_id"))
        if str(transition.get("from_track_id") or "") != left or str(transition.get("to_track_id") or "") != right:
            raise ValueError("MixPlan transition endpoints must match adjacent track order")
        technique = str(transition.get("technique") or "")
        if technique not in ALLOWED_TECHNIQUES:
            raise ValueError(f"MixPlan transition uses unsupported technique {technique!r}")
        overlap = transition.get("overlap_ms", 0)
        if not _finite(overlap) or int(overlap) < 0:
            raise ValueError("MixPlan transition overlap must be non-negative")
        left_source, right_source = _record(tracks[index].get("source")), _record(tracks[index + 1].get("source"))
        left_window = int(left_source["end_ms"]) - int(left_source["start_ms"])
        right_window = int(right_source["end_ms"]) - int(right_source["start_ms"])
        if int(overlap) > min(left_window, right_window) * 0.45 + 1:
            raise ValueError("MixPlan transition overlap exceeds the safe source-window budget")
        automation = _record(transition.get("automation"))
        if str(automation.get("version") or "") != AUTOMATION_VERSION:
            raise ValueError("MixPlan transition automation version is unsupported")
        if int(automation.get("duration_ms") or 0) != int(overlap):
            raise ValueError("MixPlan transition automation duration must equal overlap")
        _validate_envelope("from_gain", automation.get("from_gain"))
        _validate_envelope("to_gain", automation.get("to_gain"))
        low_end = automation.get("low_end_handoff")
        if low_end is not None:
            low = _record(low_end)
            cutoff = low.get("cutoff_hz")
            if not _finite(cutoff) or not 60.0 <= float(cutoff) <= 420.0:
                raise ValueError("MixPlan low-end handoff cutoff is outside the safe range")
            _validate_envelope("low_end.from_gain", low.get("from_gain"))
            _validate_envelope("low_end.to_gain", low.get("to_gain"))
        fx = automation.get("fx")
        if fx is not None:
            fx_record = _record(fx)
            if fx_record.get("kind") != "echo_out":
                raise ValueError("MixPlan transition FX kind is unsupported")
            feedback = fx_record.get("feedback")
            if not _finite(feedback) or not 0.0 <= float(feedback) <= 0.72:
                raise ValueError("MixPlan echo feedback is outside the safe range")
        confidence = transition.get("confidence", 0.5)
        if not _finite(confidence) or not 0.0 <= float(confidence) <= 1.0:
            raise ValueError("MixPlan transition confidence must be within 0..1")
        fallback = _record(transition.get("fallback"))
        if str(fallback.get("technique") or "") not in ALLOWED_TECHNIQUES:
            raise ValueError("MixPlan fallback technique is invalid")


def mixplan_hash(manifest: dict[str, Any]) -> str:
    canonical = dict(manifest)
    canonical.pop("plan_hash", None)
    payload = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
