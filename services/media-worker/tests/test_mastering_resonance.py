from __future__ import annotations

import unittest

from app.mastering_resonance import build_resonance_plan


def _source(presence: float = -8.0) -> dict:
    return {
        "reference_signature": {
            "perceptual_envelope_db": {
                "low_mid_315_630": -10.0,
                "upper_mid_1250_2500": -9.0,
                "presence_2500_4000": presence,
                "presence_4000_6000": -10.0,
                "air_6000_10000": -15.0,
            },
        }
    }


def _target(max_dynamic: float = 1.2) -> dict:
    return {
        "change_budget": {
            "max_dynamic_correction_db": max_dynamic,
            "max_eq_move_db": 1.5,
        }
    }


class MasteringResonanceV2Test(unittest.TestCase):
    def test_reference_relative_presence_excess_creates_bounded_cut(self) -> None:
        result = build_resonance_plan(
            preset="balanced",
            source_inspector=_source(-7.0),
            target=_target(1.2),
            reference_bands={"presence_2500_4000": -11.0},
        )
        self.assertTrue(result["enabled"])
        self.assertEqual(len(result["moves"]), 1)
        move = result["moves"][0]
        self.assertEqual(move["mode"], "cutabove")
        self.assertEqual(move["direction"], "downward")
        self.assertLessEqual(float(move["range_db"]), 1.2)

    def test_small_difference_does_not_create_dynamic_eq(self) -> None:
        result = build_resonance_plan(
            preset="balanced",
            source_inspector=_source(-10.0),
            target=_target(),
            reference_bands={"presence_2500_4000": -11.0},
        )
        self.assertFalse(result["enabled"])
        self.assertEqual(result["moves"], [])

    def test_streaming_safe_and_dynamic_preserve_tonal_microdynamics(self) -> None:
        for preset in ("streaming_safe", "dynamic"):
            result = build_resonance_plan(
                preset=preset,
                source_inspector=_source(-6.0),
                target=_target(),
                reference_bands={"presence_2500_4000": -12.0},
            )
            self.assertFalse(result["enabled"])
            self.assertEqual(result["reason"], "intent_preserves_tonal_microdynamics")


if __name__ == "__main__":
    unittest.main()
