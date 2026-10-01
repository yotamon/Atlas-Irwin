from __future__ import annotations

import math
from typing import Any

CHARACTER_PLAN_SCHEMA = "ensemblis.mastering_character.v1"


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def build_character_permission(
    *,
    preset: str,
    source_inspector: dict[str, Any],
    target: dict[str, Any],
) -> dict[str, Any]:
    dynamics = _record(source_inspector.get("dynamics"))
    peaks = _record(source_inspector.get("peaks"))
    plr = _number(dynamics.get("peak_to_loudness_ratio_lu"))
    clipping = int(_number(peaks.get("clipping_samples")) or 0)
    budget = _record(target.get("change_budget"))
    max_limiter_gr = _number(budget.get("max_limiter_gain_reduction_db")) or 0.0

    allowed = (
        preset == "punchy"
        and clipping == 0
        and (plr is None or plr >= 10.0)
        and max_limiter_gr >= 2.0
    )
    return {
        "schema": CHARACTER_PLAN_SCHEMA,
        "allowed": allowed,
        "enabled": False,
        "type": "tanh",
        "threshold": 0.98,
        "output": 0.99,
        "oversample": 4,
        "reason": (
            "optional_punch_character_candidate"
            if allowed
            else "character_bypassed_for_intent_or_source_safety"
        ),
    }
