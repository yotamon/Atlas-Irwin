from __future__ import annotations

import math
from typing import Any

TONAL_PLAN_SCHEMA = "ensemblis.mastering_tonal.v2"

_LEGACY_EQ_BANDS: dict[str, tuple[float, float]] = {
    "sub_20_80": (55.0, 0.8),
    "bass_80_180": (120.0, 0.9),
    "low_mid_180_500": (320.0, 1.0),
    "mid_500_2500": (1200.0, 1.0),
    "presence_2500_6000": (4200.0, 1.0),
    "air_6000_16000": (10500.0, 0.8),
}

_FINE_EQ_BANDS: dict[str, tuple[float, float]] = {
    "sub_20_40": (32.0, 0.9),
    "sub_40_80": (58.0, 0.9),
    "bass_80_160": (115.0, 0.9),
    "bass_160_315": (230.0, 0.95),
    "low_mid_315_630": (450.0, 1.0),
    "mid_630_1250": (900.0, 1.0),
    "upper_mid_1250_2500": (1800.0, 1.0),
    "presence_2500_4000": (3200.0, 1.05),
    "presence_4000_6000": (5000.0, 1.0),
    "air_6000_10000": (7800.0, 0.9),
    "air_10000_16000": (12500.0, 0.85),
}


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


def _conditional_highpass(source_signature: dict[str, Any]) -> tuple[float, str]:
    fine = _record(source_signature.get("perceptual_envelope_db"))
    sub = _number(fine.get("sub_20_40"))
    musical_bass = _number(fine.get("bass_80_160"))
    if sub is None or musical_bass is None:
        return 0.0, "insufficient_infrasonic_evidence"

    # A large 20–40 Hz share relative to 80–160 Hz can indicate rumble or
    # unusable infrasonic energy. This never reacts to the 40–80 Hz musical
    # sub band, which protects intentional dance/electronic low end.
    relative = sub - musical_bass
    if relative >= -5.5:
        return 24.0, "persistent_infrasonic_energy"
    if relative >= -8.0:
        return 20.0, "moderate_infrasonic_energy"
    return 0.0, "low_end_preserved"


def build_tonal_plan(
    *,
    preset: str,
    source_inspector: dict[str, Any],
    target: dict[str, Any],
    reference_bands: dict[str, float],
    legacy_reference_bands: dict[str, float] | None = None,
) -> dict[str, Any]:
    source_signature = _record(source_inspector.get("reference_signature"))
    source_fine = _record(source_signature.get("perceptual_envelope_db"))
    source_broad = _record(source_signature.get("band_relative_db"))
    budget = _record(target.get("change_budget"))
    max_move = _number(budget.get("max_eq_move_db"))
    max_total = _number(budget.get("max_total_eq_energy"))

    if preset == "streaming_safe":
        return {
            "schema": TONAL_PLAN_SCHEMA,
            "highpass_hz": 0.0,
            "highpass_reason": "streaming_safe_preserves_tone",
            "eq_moves": [],
            "reference_resolution": "none",
            "total_eq_energy": 0.0,
        }

    highpass_hz, highpass_reason = _conditional_highpass(source_signature)
    if max_move is None or max_move <= 0 or max_total is None or max_total <= 0:
        return {
            "schema": TONAL_PLAN_SCHEMA,
            "highpass_hz": highpass_hz,
            "highpass_reason": highpass_reason,
            "eq_moves": [],
            "reference_resolution": "none",
            "total_eq_energy": 0.0,
        }

    moves: list[dict[str, Any]] = []
    if source_fine and reference_bands:
        reference_resolution = "perceptual_12_band"
        raw: list[tuple[str, float]] = []
        for key in _FINE_EQ_BANDS:
            source_value = _number(source_fine.get(key))
            reference_value = _number(reference_bands.get(key))
            if source_value is None or reference_value is None:
                continue
            gain = (reference_value - source_value) * 0.24
            # Never boost the infrasonic band. If it is excessive, the
            # evidence-driven high-pass handles it instead.
            if key == "sub_20_40":
                gain = min(0.0, gain)
            raw.append((key, gain))

        # Smooth adjacent target moves to avoid tracing narrow reference quirks.
        smoothed: list[tuple[str, float]] = []
        for index, (key, gain) in enumerate(raw):
            neighbors = [gain]
            if index > 0:
                neighbors.append(raw[index - 1][1])
            if index + 1 < len(raw):
                neighbors.append(raw[index + 1][1])
            smoothed.append((key, sum(neighbors) / len(neighbors)))

        remaining = max_total
        for key, gain in smoothed:
            bounded = _clamp(gain, -max_move, max_move)
            if abs(bounded) < 0.22 or remaining <= 0.0:
                continue
            bounded = math.copysign(min(abs(bounded), remaining), bounded)
            frequency, q = _FINE_EQ_BANDS[key]
            moves.append({
                "band": key,
                "frequency_hz": frequency,
                "q": q,
                "gain_db": round(bounded, 2),
                "reason": "similar_trusted_reference_tonal_alignment",
            })
            remaining -= abs(bounded)
            if len(moves) >= 7:
                break
    elif source_broad and legacy_reference_bands:
        reference_resolution = "legacy_6_band"
        remaining = max_total
        for key, (frequency, q) in _LEGACY_EQ_BANDS.items():
            source_value = _number(source_broad.get(key))
            reference_value = _number(legacy_reference_bands.get(key))
            if source_value is None or reference_value is None:
                continue
            gain = _clamp((reference_value - source_value) * 0.30, -max_move, max_move)
            if key == "sub_20_80":
                gain = min(0.0, gain)
            if abs(gain) < 0.25 or remaining <= 0:
                continue
            gain = math.copysign(min(abs(gain), remaining), gain)
            moves.append({
                "band": key,
                "frequency_hz": frequency,
                "q": q,
                "gain_db": round(gain, 2),
                "reason": "legacy_trusted_reference_tonal_alignment",
            })
            remaining -= abs(gain)
    else:
        reference_resolution = "none"

    return {
        "schema": TONAL_PLAN_SCHEMA,
        "highpass_hz": highpass_hz,
        "highpass_reason": highpass_reason,
        "eq_moves": moves,
        "reference_resolution": reference_resolution,
        "total_eq_energy": round(sum(abs(float(item["gain_db"])) for item in moves), 3),
    }
