from __future__ import annotations

import unittest

from app.mastering_character import build_character_permission


class MasteringCharacterV2Test(unittest.TestCase):
    def test_only_clean_punchy_sources_may_try_character(self) -> None:
        allowed = build_character_permission(
            preset="punchy",
            source_inspector={
                "dynamics": {"peak_to_loudness_ratio_lu": 12.0},
                "peaks": {"clipping_samples": 0},
            },
            target={"change_budget": {"max_limiter_gain_reduction_db": 3.0}},
        )
        self.assertTrue(allowed["allowed"])
        self.assertFalse(allowed["enabled"])
        self.assertEqual(allowed["type"], "tanh")
        self.assertLessEqual(float(allowed["threshold"]), 1.0)

    def test_character_is_bypassed_for_non_punchy_or_clipped_source(self) -> None:
        for preset, clipping in (("balanced", 0), ("dynamic", 0), ("punchy", 4)):
            result = build_character_permission(
                preset=preset,
                source_inspector={
                    "dynamics": {"peak_to_loudness_ratio_lu": 12.0},
                    "peaks": {"clipping_samples": clipping},
                },
                target={"change_budget": {"max_limiter_gain_reduction_db": 3.0}},
            )
            self.assertFalse(result["allowed"])


if __name__ == "__main__":
    unittest.main()
