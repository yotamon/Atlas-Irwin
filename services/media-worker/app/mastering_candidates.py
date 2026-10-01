from __future__ import annotations

import math
from copy import deepcopy
from typing import Any

CANDIDATE_OPTIMIZER_SCHEMA = "ensemblis.mastering_candidates.v2"


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _shift_target(
    target: dict[str, Any],
    *,
    loudness_shift_lu: float,
    true_peak_shift_db: float = 0.0,
) -> dict[str, Any]:
    shifted = deepcopy(target)
    shifted["integrated_lufs"] = round(float(target["integrated_lufs"]) + loudness_shift_lu, 2)
    shifted["true_peak_dbtp"] = round(float(target["true_peak_dbtp"]) + true_peak_shift_db, 2)

    loudness_range = dict(_record(target.get("loudness_range")))
    for key in ("preferred_lufs", "min_lufs", "max_lufs"):
        value = _number(loudness_range.get(key))
        if value is not None:
            loudness_range[key] = round(value + loudness_shift_lu, 2)
    shifted["loudness_range"] = loudness_range

    true_peak = dict(_record(target.get("true_peak")))
    true_peak["ceiling_dbtp"] = shifted["true_peak_dbtp"]
    shifted["true_peak"] = true_peak
    return shifted


def build_candidate_family(target: dict[str, Any]) -> list[dict[str, Any]]:
    if bool(target.get("preserve_source")):
        return [{
            "id": "source_preserving",
            "role": "recommended",
            "target": deepcopy(target),
            "reason": "Streaming-safe mastering is intentionally a single transparent correction path.",
        }]

    return [
        {
            "id": "target_centered",
            "role": "recommended",
            "target": deepcopy(target),
            "reason": "Closest to the preferred creative target while remaining inside the same change budget.",
        },
        {
            "id": "more_dynamic",
            "role": "more_dynamic",
            "target": _shift_target(target, loudness_shift_lu=-0.55, true_peak_shift_db=-0.10),
            "reason": "Trades a little loudness for more transient and dynamics margin.",
        },
        {
            "id": "conservative",
            "role": "conservative",
            "target": _shift_target(target, loudness_shift_lu=-1.0, true_peak_shift_db=-0.30),
            "reason": "Prioritizes the cleanest result when the preferred target would demand too much peak control.",
        },
    ]


def build_candidate_processing_plan(
    base_plan: dict[str, Any],
    role: str,
) -> dict[str, Any]:
    plan = deepcopy(base_plan)
    plan["candidate_role"] = role

    character = dict(_record(plan.get("character")))
    character["enabled"] = bool(character.get("allowed")) and role == "recommended"
    if role != "recommended":
        character["reason"] = "bypassed_for_cleaner_candidate_variant"
    plan["character"] = character

    if role in {"more_dynamic", "conservative"}:
        compression = dict(_record(plan.get("compression")))
        compression.update({
            "enabled": False,
            "ratio": 1.0,
            "reason": f"{role}_candidate_preserves_bus_dynamics",
        })
        plan["compression"] = compression

        resonance = dict(_record(plan.get("resonance")))
        resonance.update({
            "enabled": False,
            "moves": [],
            "reason": f"{role}_candidate_bypasses_dynamic_resonance_control",
        })
        plan["resonance"] = resonance

    if role == "conservative":
        scaled_moves: list[dict[str, Any]] = []
        for move in plan.get("eq_moves") or []:
            if not isinstance(move, dict):
                continue
            gain = _number(move.get("gain_db"))
            if gain is None:
                continue
            scaled = dict(move)
            scaled["gain_db"] = round(gain * 0.65, 2)
            scaled["reason"] = "conservative_candidate_reduced_tonal_move"
            if abs(float(scaled["gain_db"])) >= 0.18:
                scaled_moves.append(scaled)
        plan["eq_moves"] = scaled_moves
        tonal = dict(_record(plan.get("tonal")))
        tonal["eq_moves"] = scaled_moves
        tonal["total_eq_energy"] = round(
            sum(abs(float(item["gain_db"])) for item in scaled_moves),
            3,
        )
        plan["tonal"] = tonal

    return plan


def _damage_penalty(checks: dict[str, Any]) -> float:
    evaluation = _record(checks.get("change_budget"))
    rows = evaluation.get("checks")
    if not isinstance(rows, list):
        return 0.0
    penalty = 0.0
    for row in rows:
        if not isinstance(row, dict):
            continue
        value = _number(row.get("value"))
        maximum = _number(row.get("maximum"))
        if value is None or maximum is None or maximum <= 0:
            continue
        ratio = value / maximum
        penalty += ratio * ratio
        if ratio > 1.0:
            penalty += (ratio - 1.0) * 8.0
    return penalty


def candidate_sort_key(candidate: dict[str, Any]) -> tuple[float, ...]:
    checks = _record(candidate.get("checks"))
    after = _record(candidate.get("after"))
    loudness = _record(after.get("loudness"))
    target = _record(candidate.get("target"))
    preferred = _number(_record(target.get("loudness_range")).get("preferred_lufs"))
    actual = _number(loudness.get("integrated_lufs"))
    loudness_distance = abs(actual - preferred) if actual is not None and preferred is not None else 99.0

    measurement = _record(candidate.get("measurement"))
    limiter_gr = _number(measurement.get("estimated_peak_gain_reduction_db")) or 0.0

    technical_pass = checks.get("technical_pass") is True
    creative_pass = checks.get("creative_pass") is True
    full_pass = checks.get("pass") is True
    return (
        0.0 if full_pass else 1.0,
        0.0 if technical_pass else 1.0,
        0.0 if creative_pass else 1.0,
        _damage_penalty(checks),
        limiter_gr,
        loudness_distance,
    )


def select_candidate(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    if not candidates:
        raise ValueError("Candidate optimizer requires at least one rendered candidate.")

    ranked = sorted(candidates, key=candidate_sort_key)
    selected = ranked[0]
    selected_id = str(selected.get("id") or "candidate")

    alternatives = []
    for item in ranked[1:]:
        checks = _record(item.get("checks"))
        if checks.get("technical_pass") is not True:
            continue
        alternatives.append({
            "id": item.get("id"),
            "role": item.get("role"),
            "pass": checks.get("pass") is True,
            "creative_pass": checks.get("creative_pass") is True,
        })

    checks = _record(selected.get("checks"))
    if checks.get("pass") is True:
        rationale = "Selected the lowest-damage candidate that fully satisfies technical and creative budgets."
    elif checks.get("technical_pass") is True:
        rationale = "No candidate fully satisfied the creative budget; selected the safest technically valid candidate for review."
    else:
        rationale = "No rendered candidate passed the technical gate; selected the least-damaging result for diagnostics only."

    return {
        "schema": CANDIDATE_OPTIMIZER_SCHEMA,
        "selected_id": selected_id,
        "selected_role": selected.get("role"),
        "rationale": rationale,
        "ranked_ids": [str(item.get("id") or "candidate") for item in ranked],
        "alternatives": alternatives,
        "selected": selected,
    }
