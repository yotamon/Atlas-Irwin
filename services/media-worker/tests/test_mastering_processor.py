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
    from app.mastering_processor import _ensure_storage_envelope, _render_candidate, build_mastering_target, build_processing_plan


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
        self.assertEqual(target_three["reference_source"], "similar_trusted_references")
        self.assertEqual(int(target_three["selected_reference_count"]), 3)
        self.assertTrue(target_three["reference_intelligence"]["automatic_influence"])
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
        self.assertTrue(target["preserve_source"])
        self.assertLessEqual(float(target["true_peak_dbtp"]), -2.0)
        self.assertEqual(float(target["static_gain_db"]), -1.9)
        self.assertEqual(float(target["integrated_lufs"]), -11.6)
        self.assertEqual(plan["eq_moves"], [])
        self.assertEqual(float(plan["highpass_hz"]), 0.0)
        self.assertFalse(plan["compression"]["enabled"])
        self.assertEqual(float(plan["compression"]["ratio"]), 1.0)
        self.assertEqual(plan["loudness"]["engine"], "static_gain")
        self.assertEqual(float(plan["loudness"]["gain_db"]), -1.9)
        self.assertFalse(plan["limiter"]["enabled"])
        self.assertEqual(target["schema"], "ensemblis.mastering_target.v2")
        self.assertEqual(target["loudness_range"]["policy"], "preserve_source")

    def test_streaming_safe_codec_risk_never_reduces_peak_headroom(self) -> None:
        source = _inspector(lufs=-15.5)
        source["codec_stress"] = [{"status": "completed", "very_low_headroom": True}]
        target = build_mastering_target("streaming_safe", source, _references(3))
        self.assertLessEqual(float(target["true_peak_dbtp"]), -2.0)
        self.assertTrue(target["codec_headroom_guard"])

    def test_streaming_safe_production_shape_uses_gain_not_peak_squeezing(self) -> None:
        source = _inspector(lufs=-13.1, true_peak=-1.0, plr=12.1, crest=13.458)
        target = build_mastering_target("streaming_safe", source, [])
        self.assertEqual(float(target["true_peak_dbtp"]), -2.0)
        self.assertEqual(float(target["static_gain_db"]), -1.0)
        self.assertEqual(float(target["integrated_lufs"]), -14.1)

    def test_streaming_safe_renderer_never_calls_loudnorm(self) -> None:
        source = _inspector(lufs=-13.1, true_peak=-1.0, plr=12.1, crest=13.458)
        target = build_mastering_target("streaming_safe", source, [])
        expected_after = {
            "technical_ready": True,
            "issue_counts": {"critical": 0},
            "loudness": {"integrated_lufs": -14.1, "true_peak_dbtp": -2.0},
            "peaks": {"clipping_samples": 0},
            "dynamics": {"peak_to_loudness_ratio_lu": 12.1},
        }

        with patch.object(mastering_processor_module, "_render_static_gain") as static_render, patch.object(
            mastering_processor_module, "_measure_loudnorm", side_effect=AssertionError("loudnorm must not run")
        ), patch.object(
            mastering_processor_module, "analyze_mastering", return_value=expected_after
        ):
            measured, after, checks = _render_candidate(
                Path("premaster.wav"),
                Path("mastered.flac"),
                {},
                source,
                target,
            )

        static_render.assert_called_once_with(
            Path("premaster.wav"),
            Path("mastered.flac"),
            -1.0,
            sample_rate_hz=48000,
        )
        self.assertEqual(measured["engine"], "static_gain")
        self.assertEqual(after, expected_after)
        self.assertTrue(checks["pass"])
        self.assertTrue(checks["dynamics_preserved"])

    def test_creative_renderer_uses_explicit_limiter_not_loudnorm_render(self) -> None:
        source = _inspector(lufs=-12.0, true_peak=-2.0, plr=12.0, crest=12.5)
        source["format"] = {"sample_rate_hz": 44100, "bit_depth": 24, "channels": 2}
        target = build_mastering_target("balanced", source, [])
        expected_after = {
            "technical_ready": True,
            "issue_counts": {"critical": 0},
            "loudness": {"integrated_lufs": -10.4, "true_peak_dbtp": -1.3},
            "peaks": {"clipping_samples": 0},
            "dynamics": {"peak_to_loudness_ratio_lu": 11.2},
        }
        loudness_measurement = {"input_i": "-12.0", "input_tp": "-2.0", "input_lra": "4.0"}

        with patch.object(
            mastering_processor_module,
            "_measure_loudnorm",
            return_value=loudness_measurement,
        ), patch.object(
            mastering_processor_module,
            "_render_explicit_limiter",
            return_value={"engine": "ffmpeg_oversampled_alimiter", "applied_gain_db": 2.0},
        ) as limiter_render, patch.object(
            mastering_processor_module,
            "analyze_mastering",
            return_value=expected_after,
        ):
            measured, after, checks = _render_candidate(
                Path("premaster.wav"),
                Path("mastered.flac"),
                {},
                source,
                target,
            )

        limiter_render.assert_called_once()
        self.assertEqual(limiter_render.call_args.kwargs["sample_rate_hz"], 44100)
        self.assertEqual(measured["engine"], "ffmpeg_oversampled_alimiter")
        self.assertEqual(after, expected_after)
        self.assertTrue(checks["pass"])

    def test_creative_target_uses_range_and_change_budget(self) -> None:
        source = _inspector(lufs=-12.0, true_peak=-2.0, plr=13.0, crest=12.0)
        source["format"] = {"sample_rate_hz": 96000, "bit_depth": 24, "channels": 2}
        target = build_mastering_target("punchy", source, [])

        self.assertEqual(target["schema"], "ensemblis.mastering_target.v2")
        self.assertEqual(target["source_resolution"]["sample_rate_hz"], 96000)
        self.assertEqual(target["source_resolution"]["canonical_processing_bit_depth"], 24)
        self.assertLess(float(target["loudness_range"]["min_lufs"]), float(target["integrated_lufs"]))
        self.assertGreater(float(target["loudness_range"]["max_lufs"]), float(target["integrated_lufs"]))
        self.assertGreater(float(target["change_budget"]["max_limiter_gain_reduction_db"]), 0.0)

    def test_storage_envelope_keeps_small_24_bit_flac(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "mastered.flac"
            output.write_bytes(b"x" * 90)
            result = _ensure_storage_envelope(output, root, sample_rate_hz=44100, max_bytes=100)
            self.assertEqual(result["profile"], "flac_24")
            self.assertEqual(result["sample_rate_hz"], 44100)
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
                result = _ensure_storage_envelope(output, root, sample_rate_hz=48000, max_bytes=100)

            self.assertEqual(result["profile"], "flac_16_native_dithered")
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
                result = _ensure_storage_envelope(output, root, sample_rate_hz=48000, max_bytes=100)

            self.assertEqual(result["profile"], "flac_16_44k_dithered")
            self.assertEqual(result["bit_depth"], 16)
            self.assertEqual(result["sample_rate_hz"], 44100)
            self.assertTrue(result["fallback_applied"])
            self.assertEqual(output.stat().st_size, 90)


if __name__ == "__main__":
    unittest.main()
