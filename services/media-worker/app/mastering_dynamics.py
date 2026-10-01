from __future__ import annotations

import math
from typing import Any

DYNAMICS_PLAN_SCHEMA = "ensemblis.mastering_dynamics.v2"


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


def build_dynamics_plan(
    preset: str,
    source_inspector: dict[str, Any],
    target: dict[str, Any],
) -> dict[str, Any]:
    dynamics = _record(source_inspector.get("dynamics"))
    transients = _record(source_inspector.get("transients"))
    signature = _record(source_inspector.get("reference_signature"))

    plr = _number(dynamics.get("peak_to_loudness_ratio_lu"))
    crest = _number(dynamics.get("crest_factor_db"))
    transient_crest = _number(transients.get("transient_crest_p90_db"))
    psr = _number(dynamics.get("psr_median_lu"))
    median_rms = _number(dynamics.get("short_term_rms_median_dbfs"))
    bpm = _number(signature.get("tempo_median_bpm"))
    change_budget = _record(target.get("change_budget"))
    max_gr = _number(change_budget.get("max_limiter_gain_reduction_db")) or 0.0

    if preset in {"streaming_safe", "dynamic"}:
        return {
            "schema": DYNAMICS_PLAN_SCHEMA,
            "enabled": False,
            "threshold_dbfs": None,
            "ratio": 1.0,
            "attack_ms": None,
            "release_ms": None,
            "knee": 2.0,
            "max_gain_reduction_db": 0.0,
            "makeup_db": 0.0,
            "reason": "intent_preserves_dynamics",
        }

    # Already dense/squashed masters should not receive more bus compression.
    if (plr is not None and plr <= 9.0) or (psr is not None and psr <= 7.5) or (crest is not None and crest <= 7.0):
        return {
            "schema": DYNAMICS_PLAN_SCHEMA,
            "enabled": False,
            "threshold_dbfs": None,
            "ratio": 1.0,
            "attack_ms": None,
            "release_ms": None,
            "knee": 2.0,
            "max_gain_reduction_db": 0.0,
            "makeup_db": 0.0,
            "reason": "source_already_dynamically_constrained",
        }

    ratio_base = 1.30 if preset == "balanced" else 1.45
    dynamic_headroom = _clamp(((plr or 11.0) - 9.0) / 6.0, 0.0, 1.0)
    ratio = _clamp(ratio_base + dynamic_headroom * 0.12, 1.2, 1.65)

    transient_evidence = transient_crest if transient_crest is not None else crest
    if transient_evidence is None:
        attack_ms = 24.0
    else:
        # Stronger transients receive slower attack so the compressor shapes body
        # rather than shaving the leading edge.
        attack_ms = _clamp(12.0 + max(0.0, transient_evidence - 6.0) * 2.2, 12.0, 38.0)

    if bpm is not None and 50.0 <= bpm <= 220.0:
        quarter_note_ms = 60000.0 / bpm
        release_ms = _clamp(quarter_note_ms * 0.38, 85.0, 280.0)
    else:
        release_ms = 180.0

    if median_rms is not None:
        threshold_dbfs = _clamp(median_rms + (4.0 if preset == "balanced" else 3.0), -24.0, -8.0)
    else:
        threshold_dbfs = -16.0 if preset == "balanced" else -15.0

    return {
        "schema": DYNAMICS_PLAN_SCHEMA,
        "enabled": True,
        "threshold_dbfs": round(threshold_dbfs, 2),
        "ratio": round(ratio, 3),
        "attack_ms": round(attack_ms, 1),
        "release_ms": round(release_ms, 1),
        "knee": 2.0,
        "max_gain_reduction_db": round(min(max_gr, 1.8 if preset == "balanced" else 2.25), 2),
        "makeup_db": 0.0,
        "reason": "program_dependent_glue_with_transient_preservation",
        "evidence": {
            "plr_lu": plr,
            "psr_median_lu": psr,
            "crest_factor_db": crest,
            "transient_crest_p90_db": transient_crest,
            "tempo_bpm": bpm,
            "short_term_rms_median_dbfs": median_rms,
        },
    }
