from __future__ import annotations

import math
from typing import Any

MASTERING_EVALUATION_SCHEMA = "ensemblis.mastering_evaluation.v2"


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _positive_loss(before: float | None, after: float | None) -> float | None:
    if before is None or after is None:
        return None
    return max(0.0, before - after)


def build_perceptual_delta(
    before: dict[str, Any],
    after: dict[str, Any],
    render_measurement: dict[str, Any] | None = None,
) -> dict[str, Any]:
    before_dynamics = _record(before.get("dynamics"))
    after_dynamics = _record(after.get("dynamics"))
    before_stereo = _record(before.get("stereo"))
    after_stereo = _record(after.get("stereo"))
    before_transients = _record(before.get("transients"))
    after_transients = _record(after.get("transients"))
    before_signature = _record(before.get("reference_signature"))
    after_signature = _record(after.get("reference_signature"))
    before_fine_bands = _record(before_signature.get("perceptual_envelope_db"))
    after_fine_bands = _record(after_signature.get("perceptual_envelope_db"))
    before_bands = before_fine_bands or _record(before_signature.get("band_relative_db"))
    after_bands = after_fine_bands or _record(after_signature.get("band_relative_db"))

    before_plr = _number(before_dynamics.get("peak_to_loudness_ratio_lu"))
    after_plr = _number(after_dynamics.get("peak_to_loudness_ratio_lu"))
    before_crest = _number(before_transients.get("transient_crest_p90_db"))
    after_crest = _number(after_transients.get("transient_crest_p90_db"))
    transient_metric = "transient_crest_p90_db"
    if before_crest is None or after_crest is None:
        before_crest = _number(before_dynamics.get("crest_factor_db"))
        after_crest = _number(after_dynamics.get("crest_factor_db"))
        transient_metric = "overall_crest_factor_db_fallback"

    before_psr = _number(before_dynamics.get("psr_median_lu"))
    after_psr = _number(after_dynamics.get("psr_median_lu"))
    before_spread = _number(before_dynamics.get("relative_dynamic_spread_db"))
    after_spread = _number(after_dynamics.get("relative_dynamic_spread_db"))

    before_corr = _number(before_stereo.get("correlation"))
    after_corr = _number(after_stereo.get("correlation"))
    before_mono = _number(before_stereo.get("mono_fold_down_delta_db"))
    after_mono = _number(after_stereo.get("mono_fold_down_delta_db"))

    band_delta_db: dict[str, float] = {}
    for key in sorted(set(before_bands) & set(after_bands)):
        source = _number(before_bands.get(key))
        candidate = _number(after_bands.get(key))
        if source is None or candidate is None:
            continue
        band_delta_db[key] = round(candidate - source, 3)

    abs_band_deltas = [abs(value) for value in band_delta_db.values()]
    mean_abs_band_delta_db = (
        sum(abs_band_deltas) / len(abs_band_deltas)
        if abs_band_deltas
        else None
    )
    max_abs_band_delta_db = max(abs_band_deltas) if abs_band_deltas else None
    # The normalized distance makes the threshold independent of the number of
    # broad analysis bands while retaining an intuitive dB-based raw value.
    spectral_envelope_distance = (
        mean_abs_band_delta_db / 6.0
        if mean_abs_band_delta_db is not None
        else None
    )

    stereo_correlation_delta = (
        abs(after_corr - before_corr)
        if before_corr is not None and after_corr is not None
        else None
    )
    mono_fold_down_regression_db = (
        max(0.0, before_mono - after_mono)
        if before_mono is not None and after_mono is not None
        else None
    )

    measurement = _record(render_measurement)
    limiter_gain_reduction = _number(
        measurement.get("estimated_peak_gain_reduction_db")
    )

    return {
        "schema": MASTERING_EVALUATION_SCHEMA,
        "plr_loss_lu": round(_positive_loss(before_plr, after_plr), 3)
        if _positive_loss(before_plr, after_plr) is not None
        else None,
        "transient_crest_loss_db": round(_positive_loss(before_crest, after_crest), 3)
        if _positive_loss(before_crest, after_crest) is not None
        else None,
        "transient_metric": transient_metric,
        "psr_median_loss_lu": round(_positive_loss(before_psr, after_psr), 3)
        if _positive_loss(before_psr, after_psr) is not None
        else None,
        "short_term_dynamic_spread_loss_db": round(_positive_loss(before_spread, after_spread), 3)
        if _positive_loss(before_spread, after_spread) is not None
        else None,
        "band_delta_db": band_delta_db,
        "mean_abs_band_delta_db": round(mean_abs_band_delta_db, 3)
        if mean_abs_band_delta_db is not None
        else None,
        "max_abs_band_delta_db": round(max_abs_band_delta_db, 3)
        if max_abs_band_delta_db is not None
        else None,
        "spectral_envelope_distance": round(spectral_envelope_distance, 4)
        if spectral_envelope_distance is not None
        else None,
        "stereo_correlation_delta": round(stereo_correlation_delta, 4)
        if stereo_correlation_delta is not None
        else None,
        "mono_fold_down_regression_db": round(mono_fold_down_regression_db, 3)
        if mono_fold_down_regression_db is not None
        else None,
        "estimated_limiter_gain_reduction_db": round(limiter_gain_reduction, 3)
        if limiter_gain_reduction is not None
        else None,
        "measurement_note": (
            "Transient preservation prefers Inspector V2 short-window crest evidence and "
            "falls back to overall crest only for legacy analyses. PSR and short-term "
            "dynamic-spread losses remain separate so density changes are not hidden by PLR."
        ),
    }


def evaluate_change_budget(
    delta: dict[str, Any],
    budget: dict[str, Any],
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def check(
        *,
        key: str,
        budget_key: str,
        label: str,
    ) -> None:
        value = _number(delta.get(key))
        maximum = _number(budget.get(budget_key))
        if value is None or maximum is None:
            checks.append({
                "metric": key,
                "status": "not_evaluated",
                "value": value,
                "maximum": maximum,
                "label": label,
            })
            return
        checks.append({
            "metric": key,
            "status": "pass" if value <= maximum else "fail",
            "value": round(value, 4),
            "maximum": round(maximum, 4),
            "label": label,
        })

    check(
        key="plr_loss_lu",
        budget_key="max_plr_loss_lu",
        label="Peak-to-loudness ratio loss",
    )
    check(
        key="transient_crest_loss_db",
        budget_key="max_transient_loss_db",
        label="Transient crest loss",
    )
    check(
        key="psr_median_loss_lu",
        budget_key="max_short_term_compression_delta_lu",
        label="Short-term PSR compression",
    )
    check(
        key="spectral_envelope_distance",
        budget_key="max_spectral_envelope_distance",
        label="Spectral-envelope movement",
    )
    check(
        key="stereo_correlation_delta",
        budget_key="max_stereo_correlation_delta",
        label="Stereo-correlation movement",
    )
    check(
        key="mono_fold_down_regression_db",
        budget_key="max_mono_fold_down_regression_db",
        label="Mono fold-down regression",
    )
    check(
        key="estimated_limiter_gain_reduction_db",
        budget_key="max_limiter_gain_reduction_db",
        label="Estimated limiter peak gain reduction",
    )

    violations = [item for item in checks if item["status"] == "fail"]
    evaluated = [item for item in checks if item["status"] != "not_evaluated"]
    return {
        "schema": MASTERING_EVALUATION_SCHEMA,
        "creative_pass": not violations,
        "violations": violations,
        "checks": checks,
        "evaluated_metric_count": len(evaluated),
        "unevaluated_metric_count": len(checks) - len(evaluated),
    }
