from __future__ import annotations

import math
from typing import Any

MASTERING_TARGET_SCHEMA = "ensemblis.mastering_target.v2"
MASTERING_CHANGE_BUDGET_SCHEMA = "ensemblis.mastering_change_budget.v1"
MASTERING_CANDIDATE_SCHEMA = "ensemblis.mastering_candidate.v2"

_DEFAULT_SAMPLE_RATE_HZ = 48_000
_MIN_SAMPLE_RATE_HZ = 32_000
_MAX_SAMPLE_RATE_HZ = 192_000

_LOUDNESS_ENVELOPES: dict[str, dict[str, float]] = {
    "streaming_safe": {
        "min_offset_lu": -0.35,
        "max_offset_lu": 0.35,
        "hard_max_gain_db": 0.0,
    },
    "balanced": {
        "min_offset_lu": -1.25,
        "max_offset_lu": 0.35,
        "hard_max_gain_db": 6.0,
    },
    "punchy": {
        "min_offset_lu": -1.0,
        "max_offset_lu": 0.25,
        "hard_max_gain_db": 7.0,
    },
    "dynamic": {
        "min_offset_lu": -1.0,
        "max_offset_lu": 0.4,
        "hard_max_gain_db": 4.5,
    },
}

_CHANGE_BUDGETS: dict[str, dict[str, float]] = {
    "streaming_safe": {
        "max_plr_loss_lu": 0.75,
        "max_transient_loss_db": 0.35,
        "max_short_term_compression_delta_lu": 0.5,
        "max_spectral_envelope_distance": 0.08,
        "max_stereo_correlation_delta": 0.04,
        "max_mono_fold_down_regression_db": 0.15,
        "max_limiter_gain_reduction_db": 0.0,
        "max_eq_move_db": 0.0,
        "max_total_eq_energy": 0.0,
    },
    "balanced": {
        "max_plr_loss_lu": 1.5,
        "max_transient_loss_db": 1.0,
        "max_short_term_compression_delta_lu": 1.25,
        "max_spectral_envelope_distance": 0.22,
        "max_stereo_correlation_delta": 0.08,
        "max_mono_fold_down_regression_db": 0.4,
        "max_limiter_gain_reduction_db": 2.5,
        "max_eq_move_db": 1.5,
        "max_total_eq_energy": 4.5,
    },
    "punchy": {
        "max_plr_loss_lu": 1.9,
        "max_transient_loss_db": 1.35,
        "max_short_term_compression_delta_lu": 1.75,
        "max_spectral_envelope_distance": 0.25,
        "max_stereo_correlation_delta": 0.08,
        "max_mono_fold_down_regression_db": 0.4,
        "max_limiter_gain_reduction_db": 3.25,
        "max_eq_move_db": 1.5,
        "max_total_eq_energy": 5.0,
    },
    "dynamic": {
        "max_plr_loss_lu": 1.0,
        "max_transient_loss_db": 0.65,
        "max_short_term_compression_delta_lu": 0.9,
        "max_spectral_envelope_distance": 0.18,
        "max_stereo_correlation_delta": 0.06,
        "max_mono_fold_down_regression_db": 0.3,
        "max_limiter_gain_reduction_db": 1.5,
        "max_eq_move_db": 1.25,
        "max_total_eq_energy": 3.5,
    },
}


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def canonical_preset(preset: str) -> str:
    return preset if preset in _LOUDNESS_ENVELOPES else "balanced"


def source_resolution(source_inspector: dict[str, Any]) -> dict[str, Any]:
    format_info = _record(source_inspector.get("format"))
    raw_sample_rate = _number(format_info.get("sample_rate_hz"))
    sample_rate = int(raw_sample_rate) if raw_sample_rate is not None else _DEFAULT_SAMPLE_RATE_HZ
    if sample_rate < _MIN_SAMPLE_RATE_HZ or sample_rate > _MAX_SAMPLE_RATE_HZ:
        sample_rate = _DEFAULT_SAMPLE_RATE_HZ

    raw_bit_depth = _number(format_info.get("bit_depth"))
    bit_depth = int(raw_bit_depth) if raw_bit_depth in {16.0, 24.0, 32.0} else None

    raw_channels = _number(format_info.get("channels"))
    channels = int(raw_channels) if raw_channels is not None and raw_channels >= 1 else 2

    return {
        "sample_rate_hz": sample_rate,
        "bit_depth": bit_depth,
        "channels": channels,
        "native_sample_rate_preserved": True,
        "canonical_processing_bit_depth": 24,
    }


def build_change_budget(preset: str) -> dict[str, Any]:
    selected = canonical_preset(preset)
    return {
        "schema": MASTERING_CHANGE_BUDGET_SCHEMA,
        **_CHANGE_BUDGETS[selected],
    }


def build_loudness_envelope(preset: str, preferred_lufs: float) -> dict[str, Any]:
    selected = canonical_preset(preset)
    policy = _LOUDNESS_ENVELOPES[selected]
    return {
        "preferred_lufs": round(preferred_lufs, 2),
        "min_lufs": round(preferred_lufs + policy["min_offset_lu"], 2),
        "max_lufs": round(preferred_lufs + policy["max_offset_lu"], 2),
        "hard_max_gain_db": policy["hard_max_gain_db"],
        "policy": "preserve_source" if selected == "streaming_safe" else "loudest_clean_within_budget",
    }


def build_v2_target_contract(
    *,
    preset: str,
    preferred_lufs: float,
    true_peak_dbtp: float,
    source_inspector: dict[str, Any],
) -> dict[str, Any]:
    selected = canonical_preset(preset)
    return {
        "schema": MASTERING_TARGET_SCHEMA,
        "candidate_schema": MASTERING_CANDIDATE_SCHEMA,
        "intent": selected,
        "loudness_range": build_loudness_envelope(selected, preferred_lufs),
        "true_peak": {
            "ceiling_dbtp": round(true_peak_dbtp, 2),
        },
        "change_budget": build_change_budget(selected),
        "source_resolution": source_resolution(source_inspector),
        "decision_policy": {
            "loudness_is_not_quality": True,
            "may_stop_below_preferred_lufs": selected != "streaming_safe",
            "technical_and_creative_pass_are_separate": True,
        },
    }
