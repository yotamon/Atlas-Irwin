from __future__ import annotations

import unittest

from app.mastering_contracts import (
    MASTERING_CANDIDATE_SCHEMA,
    MASTERING_CHANGE_BUDGET_SCHEMA,
    MASTERING_TARGET_SCHEMA,
    build_change_budget,
    build_loudness_envelope,
    build_v2_target_contract,
    source_resolution,
)


class MasteringContractsV2Test(unittest.TestCase):
    def test_native_resolution_is_preserved_when_supported(self) -> None:
        result = source_resolution({
            "format": {
                "sample_rate_hz": 96000,
                "bit_depth": 24,
                "channels": 2,
            }
        })
        self.assertEqual(result["sample_rate_hz"], 96000)
        self.assertEqual(result["bit_depth"], 24)
        self.assertEqual(result["channels"], 2)
        self.assertTrue(result["native_sample_rate_preserved"])
        self.assertEqual(result["canonical_processing_bit_depth"], 24)

    def test_invalid_resolution_falls_back_conservatively(self) -> None:
        result = source_resolution({
            "format": {
                "sample_rate_hz": 500000,
                "bit_depth": 20,
                "channels": 0,
            }
        })
        self.assertEqual(result["sample_rate_hz"], 48000)
        self.assertIsNone(result["bit_depth"])
        self.assertEqual(result["channels"], 2)

    def test_streaming_safe_has_zero_creative_change_budget(self) -> None:
        budget = build_change_budget("streaming_safe")
        self.assertEqual(budget["schema"], MASTERING_CHANGE_BUDGET_SCHEMA)
        self.assertEqual(float(budget["max_limiter_gain_reduction_db"]), 0.0)
        self.assertEqual(float(budget["max_eq_move_db"]), 0.0)
        self.assertEqual(float(budget["max_total_eq_energy"]), 0.0)

    def test_creative_loudness_envelope_allows_loudest_clean_stop(self) -> None:
        envelope = build_loudness_envelope("balanced", -10.0)
        self.assertEqual(envelope["policy"], "loudest_clean_within_budget")
        self.assertEqual(float(envelope["preferred_lufs"]), -10.0)
        self.assertLess(float(envelope["min_lufs"]), -10.0)
        self.assertGreater(float(envelope["max_lufs"]), -10.0)

    def test_v2_target_keeps_technical_and_creative_pass_separate(self) -> None:
        result = build_v2_target_contract(
            preset="punchy",
            preferred_lufs=-9.0,
            true_peak_dbtp=-1.2,
            source_inspector={
                "format": {
                    "sample_rate_hz": 44100,
                    "bit_depth": 24,
                    "channels": 2,
                }
            },
        )
        self.assertEqual(result["schema"], MASTERING_TARGET_SCHEMA)
        self.assertEqual(result["candidate_schema"], MASTERING_CANDIDATE_SCHEMA)
        self.assertEqual(result["intent"], "punchy")
        self.assertTrue(result["decision_policy"]["loudness_is_not_quality"])
        self.assertTrue(result["decision_policy"]["may_stop_below_preferred_lufs"])
        self.assertTrue(result["decision_policy"]["technical_and_creative_pass_are_separate"])


if __name__ == "__main__":
    unittest.main()
