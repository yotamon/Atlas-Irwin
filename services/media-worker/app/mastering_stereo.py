from __future__ import annotations

import math
from typing import Any

STEREO_PLAN_SCHEMA = "ensemblis.mastering_stereo.v2"


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def build_stereo_plan(
    preset: str,
    source_inspector: dict[str, Any],
    target: dict[str, Any],
) -> dict[str, Any]:
    stereo = _record(source_inspector.get("stereo"))
    band_side_share = _record(stereo.get("band_side_share"))
    correlation = _number(stereo.get("correlation"))
    mono_delta = _number(stereo.get("mono_fold_down_delta_db"))
    low_side = max(
        _number(band_side_share.get("sub_20_80")) or 0.0,
        _number(band_side_share.get("bass_80_180")) or 0.0,
    )
    issues = [
        item for item in source_inspector.get("issues") or []
        if isinstance(item, dict)
    ]
    severe_phase = any(
        item.get("code") == "phase_risk" and item.get("severity") in {"critical", "review"}
        for item in issues
    )
    localized_mono_loss = any(
        item.get("code") == "localized_mono_loss"
        for item in issues
    )

    if preset == "streaming_safe":
        return {
            "schema": STEREO_PLAN_SCHEMA,
            "mode": "preserve",
            "enabled": False,
            "side_level": 1.0,
            "reason": "streaming_safe_preserves_stereo",
            "blind_widening_allowed": False,
        }

    if severe_phase and (correlation is None or correlation < -0.2):
        return {
            "schema": STEREO_PLAN_SCHEMA,
            "mode": "preserve",
            "enabled": False,
            "side_level": 1.0,
            "reason": "severe_phase_risk_requires_source_or_mix_review",
            "blind_widening_allowed": False,
        }

    # FFmpeg's simple stereotools stage is broadband. Use it only for a very
    # small corrective side trim when low-end/mono evidence is strong enough.
    # A future crossover M/S stage may make the correction frequency-specific.
    side_level = 1.0
    reason = "healthy_stereo_preserved"
    if low_side >= 0.52 or (localized_mono_loss and low_side >= 0.42):
        side_level = 0.88
        reason = "measured_translation_risk_gentle_side_trim"
    elif low_side >= 0.46 and mono_delta is not None and mono_delta < -1.6:
        side_level = 0.92
        reason = "wide_low_end_with_mono_loss_gentle_side_trim"

    enabled = side_level < 0.999
    return {
        "schema": STEREO_PLAN_SCHEMA,
        "mode": "corrective_side_trim" if enabled else "preserve",
        "enabled": enabled,
        "side_level": side_level,
        "side_trim_db": round(20.0 * math.log10(side_level), 3) if enabled else 0.0,
        "reason": reason,
        "blind_widening_allowed": False,
        "evidence": {
            "low_frequency_side_share": round(low_side, 4),
            "correlation": correlation,
            "mono_fold_down_delta_db": mono_delta,
            "localized_mono_loss": localized_mono_loss,
        },
    }
