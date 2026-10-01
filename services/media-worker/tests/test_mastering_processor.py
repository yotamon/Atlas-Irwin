from __future__ import annotations

import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

# Planning tests intentionally avoid importing the heavyweight canonical analyzer stack.
# Production imports the real app.main helpers after the worker bootstrap installs them.
fake_main = types.ModuleType("app.main")
fake_main.download = lambda *args, **kwargs: None
fake_main.upload_file = lambda *args, **kwargs: None
fake_main.sha256_file = lambda *args, **kwargs: "test"
with patch.dict(sys.modules, {"app.main": fake_main}):
    from app import mastering_processor as mastering_processor_module
    from app.mastering_processor import _ensure_storage_envelope, build_mastering_target, build_processing_plan


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

    def test_streaming_safe_preserves_source_and_ignores_reference_tone(self) -> None:
        source = _inspector(lufs=-9.7, plr=14.0, crest=13.0)
        refs = _references(4)
        target = build_mastering_target("streaming_safe", source, refs)
        plan = build_processing_plan("streaming_safe", source, target, refs)

        self.assertEqual(target["reference_source"], "source_preservation")
        self.assertEqual(float(target["integrated_lufs"]), -9.7)
        self.assertTrue(target["preserve_source"])
        self.assertLessEqual(float(target["true_peak_dbtp"]), -2.0)
        self.assertEqual(plan["eq_moves"], [])
        self.assertEqual(float(plan["highpass_hz"]), 0.0)
        self.assertFalse(plan["compression"]["enabled"])
        self.assertEqual(float(plan["compression"]["ratio"]), 1.0)

    def test_streaming_safe_codec_risk_never_reduces_peak_headroom(self) -> None:
        source = _inspector(lufs=-15.5)
        source["codec_stress"] = [{"status": "completed", "very_low_headroom": True}]
        target = build_mastering_target("streaming_safe", source, _references(3))
        self.assertLessEqual(float(target["true_peak_dbtp"]), -2.0)
        self.assertTrue(target["codec_headroom_guard"])

    def test_storage_envelope_keeps_small_24_bit_flac(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "mastered.flac"
            output.write_bytes(b"x" * 90)
            result = _ensure_storage_envelope(output, root, max_bytes=100)
            self.assertEqual(result["profile"], "flac_24")
            self.assertFalse(result["fallback_applied"])
            self.assertEqual(output.stat().st_size, 90)

    def test_storage_envelope_falls_back_to_dithered_16_bit_flac(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "mastered.flac"
            output.write_bytes(b"x" * 180)

            def fake_encode(_source: Path, target: Path, *, bit_depth: int, sample_rate_hz: int) -> None:
                self.assertEqual(bit_depth, 16)
                target.write_bytes(b"y" * (80 if sample_rate_hz == 48000 else 70))

            with patch.object(mastering_processor_module, "_encode_flac_variant", side_effect=fake_encode):
                result = _ensure_storage_envelope(output, root, max_bytes=100)

            self.assertEqual(result["profile"], "flac_16_dithered")
            self.assertEqual(result["bit_depth"], 16)
            self.assertEqual(result["sample_rate_hz"], 48000)
            self.assertTrue(result["fallback_applied"])
            self.assertEqual(output.stat().st_size, 80)

    def test_storage_envelope_can_reduce_sample_rate_without_lossy_audio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "mastered.flac"
            output.write_bytes(b"x" * 180)

            def fake_encode(_source: Path, target: Path, *, bit_depth: int, sample_rate_hz: int) -> None:
                target.write_bytes(b"y" * (120 if sample_rate_hz == 48000 else 90))

            with patch.object(mastering_processor_module, "_encode_flac_variant", side_effect=fake_encode):
                result = _ensure_storage_envelope(output, root, max_bytes=100)

            self.assertEqual(result["profile"], "flac_16_44k_dithered")
            self.assertEqual(result["bit_depth"], 16)
            self.assertEqual(result["sample_rate_hz"], 44100)
            self.assertTrue(result["fallback_applied"])
            self.assertEqual(output.stat().st_size, 90)


if __name__ == "__main__":
    unittest.main()
