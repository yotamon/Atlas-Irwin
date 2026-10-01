from __future__ import annotations

import math
from typing import Any

RESONANCE_PLAN_SCHEMA = "ensemblis.mastering_resonance.v1"

_TARGET_BANDS: dict[str, tuple[float, float]] = {
    "low_mid_315_630": (450.0, 1.5),
    "upper_mid_1250_2500": (1800.0, 1.6),
    "presence_2500_4000": (3200.0, 1.8),
    "presence_4000_6000": (5000.0, 1.8),
    "air_6000_10000": (7800.0, 1.4),
}


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def build_resonance_plan(
    *,
    preset: str,
    source_inspector: dict[str, Any],
    target: dict[str, Any],
    reference_bands: dict[str, float],
) -> dict[str, Any]:
    if preset in {"streaming_safe", "dynamic"}:
        return {
            "schema": RESONANCE_PLAN_SCHEMA,
            "enabled": False,
            "moves": [],
            "reason": "intent_preserves_tonal_microdynamics",
        }

    source_signature = _record(source_inspector.get("reference_signature"))
    source_bands = _record(source_signature.get("perceptual_envelope_db"))
    budget = _record(target.get("change_budget"))
    max_dynamic = _number(budget.get("max_dynamic_correction_db"))
    if max_dynamic is None:
        max_dynamic = min(1.5, _number(budget.get("max_eq_move_db")) or 0.0)
    if max_dynamic <= 0.0 or not source_bands or not reference_bands:
        return {
            "schema": RESONANCE_PLAN_SCHEMA,
            "enabled": False,
            "moves": [],
            "reason": "insufficient_reference_or_budget_evidence",
        }

    moves: list[dict[str, Any]] = []
    for key, (frequency, q) in _TARGET_BANDS.items():
        source = _number(source_bands.get(key))
        reference = _number(reference_bands.get(key))
        if source is None or reference is None:
            continue
        excess_db = source - reference
        if excess_db < 2.75:
            continue
        range_db = min(max_dynamic, max(0.5, (excess_db - 1.75) * 0.45))
        moves.append({
            "band": key,
            "frequency_hz": frequency,
            "detector_q": q,
            "target_q": q,
            "range_db": round(range_db, 2),
            "ratio": 2.0,
            "attack_ms": 18.0 if frequency >= 2500 else 28.0,
            "release_ms": 130.0 if frequency >= 2500 else 180.0,
            "mode": "cutabove",
            "direction": "downward",
            "reason": "persistent_reference_relative_excess",
            "evidence": {
                "source_db": round(source, 2),
                "reference_db": round(reference, 2),
                "excess_db": round(excess_db, 2),
            },
        })
        if len(moves) >= 2:
            break

    return {
        "schema": RESONANCE_PLAN_SCHEMA,
        "enabled": bool(moves),
        "moves": moves,
        "reason": "reference_backed_dynamic_attenuation" if moves else "no_persistent_reference_relative_excess",
    }
