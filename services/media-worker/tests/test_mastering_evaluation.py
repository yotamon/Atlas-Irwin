from __future__ import annotations

import unittest

from app.mastering_evaluation import build_perceptual_delta, evaluate_change_budget


def _inspector(
    *,
    plr: float,
    crest: float,
    correlation: float,
    mono_delta: float,
    bands: dict[str, float],
) -> dict:
    return {
        "dynamics": {
            "peak_to_loudness_ratio_lu": plr,
            "crest_factor_db": crest,
        },
        "stereo": {
            "correlation": correlation,
            "mono_fold_down_delta_db": mono_delta,
        },
        "reference_signature": {
            "band_relative_db": bands,
        },
    }


class MasteringEvaluationV2Test(unittest.TestCase):
    def test_small_changes_pass_budget(self) -> None:
        before = _inspector(
            plr=12.0,
            crest=11.0,
            correlation=0.65,
            mono_delta=-0.4,
            bands={"bass": -9.0, "mid": -5.0, "air": -15.0},
        )
        after = _inspector(
            plr=11.3,
            crest=10.4,
            correlation=0.69,
            mono_delta=-0.55,
            bands={"bass": -8.6, "mid": -5.2, "air": -14.5},
        )
        delta = build_perceptual_delta(
            before,
            after,
            {"estimated_peak_gain_reduction_db": 1.2},
        )
        result = evaluate_change_budget(
            delta,
            {
                "max_plr_loss_lu": 1.5,
                "max_transient_loss_db": 1.0,
                "max_spectral_envelope_distance": 0.22,
                "max_stereo_correlation_delta": 0.08,
                "max_mono_fold_down_regression_db": 0.4,
                "max_limiter_gain_reduction_db": 2.5,
            },
        )
        self.assertTrue(result["creative_pass"])
        self.assertEqual(result["violations"], [])

    def test_loud_candidate_can_fail_for_damage(self) -> None:
        before = _inspector(
            plr=13.0,
            crest=12.0,
            correlation=0.7,
            mono_delta=-0.3,
            bands={"bass": -9.0, "mid": -5.0, "air": -15.0},
        )
        after = _inspector(
            plr=9.5,
            crest=8.0,
            correlation=0.48,
            mono_delta=-1.4,
            bands={"bass": -5.0, "mid": -8.0, "air": -9.0},
        )
        delta = build_perceptual_delta(
            before,
            after,
            {"estimated_peak_gain_reduction_db": 4.5},
        )
        result = evaluate_change_budget(
            delta,
            {
                "max_plr_loss_lu": 1.5,
                "max_transient_loss_db": 1.0,
                "max_spectral_envelope_distance": 0.22,
                "max_stereo_correlation_delta": 0.08,
                "max_mono_fold_down_regression_db": 0.4,
                "max_limiter_gain_reduction_db": 2.5,
            },
        )
        self.assertFalse(result["creative_pass"])
        failed_metrics = {item["metric"] for item in result["violations"]}
        self.assertIn("plr_loss_lu", failed_metrics)
        self.assertIn("transient_crest_loss_db", failed_metrics)
        self.assertIn("stereo_correlation_delta", failed_metrics)
        self.assertIn("mono_fold_down_regression_db", failed_metrics)
        self.assertIn("estimated_limiter_gain_reduction_db", failed_metrics)

    def test_missing_metrics_do_not_create_false_failure(self) -> None:
        delta = build_perceptual_delta({}, {}, {})
        result = evaluate_change_budget(
            delta,
            {
                "max_plr_loss_lu": 1.0,
                "max_transient_loss_db": 1.0,
            },
        )
        self.assertTrue(result["creative_pass"])
        self.assertGreater(result["unevaluated_metric_count"], 0)


if __name__ == "__main__":
    unittest.main()
