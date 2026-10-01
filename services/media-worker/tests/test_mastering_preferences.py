from __future__ import annotations

import unittest

from app.mastering_preferences import apply_mastering_preferences


class MasteringPreferencePolicyTest(unittest.TestCase):
    def test_weak_history_has_no_influence(self) -> None:
        result = apply_mastering_preferences(
            preset="balanced",
            preferred_lufs=-10.0,
            change_budget={
                "max_limiter_gain_reduction_db": 2.5,
                "max_total_eq_energy": 4.5,
            },
            preferences={
                "confidence": 0.3,
                "evidence_count": 1,
                "approved_count": 1,
                "preferred_creative_lufs": -9.0,
                "max_loudness_nudge_lu": 0.6,
            },
        )
        self.assertFalse(result["applied"])
        self.assertEqual(float(result["preferred_lufs"]), -10.0)

    def test_history_nudges_loudness_only_within_bound(self) -> None:
        result = apply_mastering_preferences(
            preset="balanced",
            preferred_lufs=-10.0,
            change_budget={
                "max_limiter_gain_reduction_db": 2.5,
                "max_total_eq_energy": 4.5,
            },
            preferences={
                "confidence": 0.8,
                "evidence_count": 6,
                "approved_count": 4,
                "preferred_creative_lufs": -8.0,
                "max_loudness_nudge_lu": 0.6,
                "may_tighten_damage_budget": False,
            },
        )
        self.assertTrue(result["applied"])
        self.assertLessEqual(float(result["loudness_nudge_lu"]), 0.6)
        self.assertAlmostEqual(float(result["preferred_lufs"]), -9.52, places=2)

    def test_history_may_tighten_but_never_loosen_damage_budget(self) -> None:
        result = apply_mastering_preferences(
            preset="punchy",
            preferred_lufs=-9.0,
            change_budget={
                "max_limiter_gain_reduction_db": 3.25,
                "max_total_eq_energy": 5.0,
            },
            preferences={
                "confidence": 0.8,
                "evidence_count": 8,
                "approved_count": 5,
                "preferred_creative_lufs": -9.1,
                "preferred_limiter_gain_reduction_db": 1.2,
                "preferred_eq_energy": 1.8,
                "max_loudness_nudge_lu": 0.6,
                "may_tighten_damage_budget": True,
            },
        )
        budget = result["change_budget"]
        self.assertLess(float(budget["max_limiter_gain_reduction_db"]), 3.25)
        self.assertLess(float(budget["max_total_eq_energy"]), 5.0)
        self.assertFalse(result["technical_safety_may_be_loosened"])

    def test_streaming_safe_is_never_personalized_creatively(self) -> None:
        result = apply_mastering_preferences(
            preset="streaming_safe",
            preferred_lufs=-14.0,
            change_budget={"max_limiter_gain_reduction_db": 0.0},
            preferences={
                "confidence": 0.9,
                "evidence_count": 20,
                "approved_count": 20,
                "preferred_creative_lufs": -8.0,
                "max_loudness_nudge_lu": 0.6,
            },
        )
        self.assertFalse(result["applied"])
        self.assertEqual(float(result["preferred_lufs"]), -14.0)


if __name__ == "__main__":
    unittest.main()
