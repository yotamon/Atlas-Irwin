from __future__ import annotations

import unittest

from app.mastering_processor import build_mastering_target, build_processing_plan


def _inspector(*, lufs: float = -7.5, true_peak: float = -0.1, plr: float = 9.0, crest: float = 8.5):
    return {
        "loudness": {"integrated_lufs": lufs, "true_peak_dbtp": true_peak},
        "dynamics": {
            "loudness_range_lu": 4.5,
            "peak_to_loudness_ratio_lu": plr,
            "crest_factor_db": crest,
        },
        "reference_signature": {
            "integrated_lufs": lufs,
            "true_peak_dbtp": true_peak,
            "band_relative_db": {
                "sub_20_80": -18.0,
                "bass_80_180": -9.0,
                "low_mid_180_500": -8.0,
                "mid_500_2500": -5.0,
                "presence_2500_6000": -11.0,
                "air_6000_16000": -17.0,
            },
        },
        "codec_stress": [],
        "issues": [],
    }


def _references(count: int = 3):
    return [
        {
            "integrated_lufs": -9.5 + index * 0.2,
            "band_relative_db": {
                "sub_20_80": -19.0,
                "bass_80_180": -10.0,
                "low_mid_180_500": -8.5,
                "mid_500_2500": -5.0,
                "presence_2500_6000": -10.0,
                "air_6000_16000": -16.0,
            },
        }
        for index in range(count)
    ]


class ActiveMasteringPlanTest(unittest.TestCase):
    def test_catalog_requires_three_references(self) -> None:
        source = _inspector()
        target_two = build_mastering_target("balanced", source, _references(2))
        target_three = build_mastering_target("balanced", source, _references(3))
        self.assertEqual(target_two["reference_source"], "preset")
        self.assertEqual(target_three["reference_source"], "artist_catalog")
        self.assertGreaterEqual(float(target_three["integrated_lufs"]), -13.0)
        self.assertLessEqual(float(target_three["integrated_lufs"]), -8.5)

    def test_codec_risk_increases_true_peak_headroom(self) -> None:
        source = _inspector()
        source["codec_stress"] = [{"status": "completed", "very_low_headroom": True}]
        target = build_mastering_target("punchy", source, [])
        self.assertLessEqual(float(target["true_peak_dbtp"]), -1.8)
        self.assertTrue(target["codec_headroom_guard"])

    def test_catalog_eq_moves_are_small_and_bounded(self) -> None:
        source = _inspector()
        refs = _references(3)
        target = build_mastering_target("balanced", source, refs)
        plan = build_processing_plan("balanced", source, target, refs)
        moves = plan["eq_moves"]
        self.assertTrue(moves)
        self.assertTrue(all(abs(float(move["gain_db"])) <= 1.5 for move in moves))
        self.assertEqual(plan["stereo"]["mode"], "preserve")

    def test_dynamic_preset_never_adds_compression(self) -> None:
        source = _inspector(plr=14.0, crest=13.0)
        target = build_mastering_target("dynamic", source, [])
        plan = build_processing_plan("dynamic", source, target, [])
        self.assertFalse(plan["compression"]["enabled"])

    def test_squashed_source_is_not_compressed_further(self) -> None:
        source = _inspector(plr=6.0, crest=5.5)
        target = build_mastering_target("punchy", source, [])
        plan = build_processing_plan("punchy", source, target, [])
        self.assertFalse(plan["compression"]["enabled"])


if __name__ == "__main__":
    unittest.main()
