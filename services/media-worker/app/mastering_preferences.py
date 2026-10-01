from __future__ import annotations

import math
from typing import Any

MASTERING_PREFERENCE_POLICY_SCHEMA = "ensemblis.mastering_preference_policy.v1"


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def apply_mastering_preferences(
    *,
    preset: str,
    preferred_lufs: float,
    change_budget: dict[str, Any],
    preferences: dict[str, Any],
) -> dict[str, Any]:
    confidence = _clamp(_number(preferences.get("confidence")) or 0.0, 0.0, 1.0)
    evidence_count = int(_number(preferences.get("evidence_count")) or 0)
    approved_count = int(_number(preferences.get("approved_count")) or 0)
    if preset == "streaming_safe" or confidence < 0.5 or evidence_count < 2 or approved_count < 1:
        return {
            "schema": MASTERING_PREFERENCE_POLICY_SCHEMA,
            "applied": False,
            "preferred_lufs": round(preferred_lufs, 2),
            "change_budget": dict(change_budget),
            "confidence": round(confidence, 4),
            "evidence_count": evidence_count,
            "reason": "insufficient_preference_evidence_or_source_preserving_intent",
        }

    max_nudge = _clamp(
        _number(preferences.get("max_loudness_nudge_lu")) or 0.0,
        0.0,
        0.6,
    )
    learned_lufs = _number(preferences.get("preferred_creative_lufs"))
    loudness_nudge = 0.0
    if learned_lufs is not None and max_nudge > 0:
        raw = _clamp(learned_lufs - preferred_lufs, -max_nudge, max_nudge)
        loudness_nudge = raw * confidence

    next_budget = dict(change_budget)
    tightened: dict[str, float] = {}
    if bool(preferences.get("may_tighten_damage_budget")):
        learned_limiter = _number(preferences.get("preferred_limiter_gain_reduction_db"))
        current_limiter = _number(next_budget.get("max_limiter_gain_reduction_db"))
        if learned_limiter is not None and current_limiter is not None:
            tightened_limiter = min(current_limiter, max(0.75, learned_limiter + 0.5))
            next_budget["max_limiter_gain_reduction_db"] = round(tightened_limiter, 3)
            tightened["max_limiter_gain_reduction_db"] = round(tightened_limiter, 3)

        learned_eq = _number(preferences.get("preferred_eq_energy"))
        current_eq = _number(next_budget.get("max_total_eq_energy"))
        if learned_eq is not None and current_eq is not None:
            tightened_eq = min(current_eq, max(1.0, learned_eq + 0.8))
            next_budget["max_total_eq_energy"] = round(tightened_eq, 3)
            tightened["max_total_eq_energy"] = round(tightened_eq, 3)

    return {
        "schema": MASTERING_PREFERENCE_POLICY_SCHEMA,
        "applied": abs(loudness_nudge) >= 0.01 or bool(tightened),
        "preferred_lufs": round(preferred_lufs + loudness_nudge, 2),
        "loudness_nudge_lu": round(loudness_nudge, 3),
        "change_budget": next_budget,
        "tightened_budget": tightened,
        "confidence": round(confidence, 4),
        "evidence_count": evidence_count,
        "reason": "explicit_artist_mastering_history_bounded_influence",
        "technical_safety_may_be_loosened": False,
    }
