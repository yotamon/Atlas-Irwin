from __future__ import annotations

import unittest

from app.mastering_tonal import build_tonal_plan


def _source(*, sub_20_40: float = -24.0, bass_80_160: float = -8.0) -> dict:
    return {
        "reference_signature": {
            "perceptual_envelope_db": {
                "sub_20_40": sub_20_40,
                "sub_40_80": -12.0,
                "bass_80_160": bass_80_160,
                "bass_160_315": -8.5,
                "low_mid_315_630": -10.0,
                "mid_630_1250": -9.0,
                "upper_mid_1250_2500": -10.0,
                "presence_2500_4000": -12.0,
                "presence_4000_6000": -14.0,
                "air_6000_10000": -17.0,
                "air_10000_16000": -22.0,
                "ultra_16000_20000": -30.0,
            },
            "band_relative_db": {
                "sub_20_80": -18.0,
                "bass_80_180": -9.0,
                "low_mid_180_500": -9.5,
                "mid_500_2500": -6.0,
                "presence_2500_6000": -11.0,
                "air_6000_16000": -17.0,
            },
        }
    }


def _target() -> dict:
    return {
        "change_budget": {
            "max_eq_move_db": 1.5,
            "max_total_eq_energy": 4.5,
        }
    }


class MasteringTonalV2Test(unittest.TestCase):
    def test_healthy_low_end_is_not_high_passed(self) -> None:
        result = build_tonal_plan(
            preset="balanced",
            source_inspector=_source(sub_20_40=-24.0, bass_80_160=-8.0),
            target=_target(),
            reference_bands={},
        )
        self.assertEqual(float(result["highpass_hz"]), 0.0)
        self.assertEqual(result["highpass_reason"], "low_end_preserved")

    def test_infrasonic_heavy_source_gets_bounded_cleanup(self) -> None:
        result = build_tonal_plan(
            preset="balanced",
            source_inspector=_source(sub_20_40=-11.0, bass_80_160=-8.0),
            target=_target(),
            reference_bands={},
        )
        self.assertEqual(float(result["highpass_hz"]), 24.0)
        self.assertEqual(result["highpass_reason"], "persistent_infrasonic_energy")

    def test_streaming_safe_never_changes_tone(self) -> None:
        result = build_tonal_plan(
            preset="streaming_safe",
            source_inspector=_source(sub_20_40=-10.0, bass_80_160=-8.0),
            target=_target(),
            reference_bands={"bass_80_160": -4.0},
        )
        self.assertEqual(float(result["highpass_hz"]), 0.0)
        self.assertEqual(result["eq_moves"], [])

    def test_fine_reference_moves_are_bounded_and_total_budgeted(self) -> None:
        reference = {
            "sub_20_40": -18.0,
            "sub_40_80": -10.0,
            "bass_80_160": -6.0,
            "bass_160_315": -7.0,
            "low_mid_315_630": -12.0,
            "mid_630_1250": -8.0,
            "upper_mid_1250_2500": -8.0,
            "presence_2500_4000": -10.0,
            "presence_4000_6000": -12.0,
            "air_6000_10000": -14.0,
            "air_10000_16000": -18.0,
        }
        result = build_tonal_plan(
            preset="balanced",
            source_inspector=_source(),
            target=_target(),
            reference_bands=reference,
        )
        self.assertEqual(result["reference_resolution"], "perceptual_12_band")
        self.assertTrue(result["eq_moves"])
        self.assertLessEqual(float(result["total_eq_energy"]), 4.5)
        self.assertTrue(all(abs(float(move["gain_db"])) <= 1.5 for move in result["eq_moves"]))
        sub_moves = [move for move in result["eq_moves"] if move["band"] == "sub_20_40"]
        self.assertTrue(all(float(move["gain_db"]) <= 0.0 for move in sub_moves))


if __name__ == "__main__":
    unittest.main()
