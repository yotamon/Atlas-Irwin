from __future__ import annotations

from typing import Any

from .automix_manifest import validate_mixplan


def _records(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def evaluate_mixplan(manifest: dict[str, Any]) -> dict[str, Any]:
    """Return deterministic quality diagnostics suitable for CI and production telemetry.

    This intentionally evaluates contracts and planner evidence, not subjective DJ taste.
    Subjective listening benchmarks can layer on top without weakening hard safety checks.
    """
    validate_mixplan(manifest)
    tracks = _records(manifest.get("tracks"))
    transitions = _records(manifest.get("transitions"))
    requested = max(1, int(manifest.get("requested_duration_ms") or 1))
    estimated = max(0, int(manifest.get("estimated_duration_ms") or 0))
    duration_error = abs(estimated - requested) / requested

    risky = [item for item in transitions if item.get("risk_flags")]
    low_confidence = [item for item in transitions if float(item.get("confidence") or 0.0) < 0.58]
    unsafe_long_blends = [
        item for item in transitions
        if int(item.get("bars") or 0) >= 16
        and (
            float(dict(item.get("metrics") or {}).get("boundary_safety") or 0.0) < 0.52
            or float(dict(item.get("metrics") or {}).get("tempo_reliability") or 0.0) < 0.68
            or float(dict(item.get("metrics") or {}).get("vocal_collision") or 0.0) >= 0.34
        )
    ]
    fallback_missing = [item for item in transitions if not isinstance(item.get("fallback"), dict)]
    excessive_stretch = [
        item for item in tracks
        if abs(float(dict(item.get("playback") or {}).get("time_factor") or 1.0) - 1.0) > 0.060001
    ]

    transition_confidences = [float(item.get("confidence") or 0.0) for item in transitions]
    mean_confidence = sum(transition_confidences) / len(transition_confidences) if transition_confidences else 1.0
    hard_failures = len(unsafe_long_blends) + len(fallback_missing) + len(excessive_stretch)
    warnings = len(risky) + len(low_confidence)
    score = max(
        0.0,
        min(
            1.0,
            0.48 * mean_confidence
            + 0.28 * max(0.0, 1.0 - duration_error)
            + 0.24 * max(0.0, 1.0 - warnings / max(1, len(transitions)))
            - 0.35 * hard_failures,
        ),
    )
    return {
        "pass": hard_failures == 0,
        "score": round(score, 4),
        "track_count": len(tracks),
        "transition_count": len(transitions),
        "requested_duration_ms": requested,
        "estimated_duration_ms": estimated,
        "duration_error_ratio": round(duration_error, 5),
        "mean_transition_confidence": round(mean_confidence, 4),
        "risky_transition_count": len(risky),
        "low_confidence_transition_count": len(low_confidence),
        "unsafe_long_blend_count": len(unsafe_long_blends),
        "missing_fallback_count": len(fallback_missing),
        "excessive_stretch_count": len(excessive_stretch),
    }
