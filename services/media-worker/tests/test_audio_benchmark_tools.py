from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

from benchmarks.evaluate_mir import evaluate
from benchmarks.generate_robustness_corpus import _build_variants


class AudioBenchmarkToolsTest(unittest.TestCase):
    def test_mir_evaluator_reports_perfect_scores_for_identical_timing(self) -> None:
        annotation = {
            "bpm": 120.0,
            "beats_ms": [0, 500, 1000, 1500, 2000],
            "downbeats_ms": [0, 2000],
            "section_intervals_s": [[0.0, 1.0], [1.0, 2.0]],
        }
        analysis = {
            "bpm": 120.0,
            "beats_ms": [0, 500, 1000, 1500, 2000],
            "downbeats_ms": [0, 2000],
            "sections": [
                {"start_ms": 0, "end_ms": 1000},
                {"start_ms": 1000, "end_ms": 2000},
            ],
        }

        metrics = evaluate(annotation, analysis)

        self.assertAlmostEqual(metrics["beat_f_measure"], 1.0, places=5)
        self.assertAlmostEqual(metrics["downbeat_f_measure"], 1.0, places=5)
        self.assertAlmostEqual(metrics["section_boundary_f_measure_500ms"], 1.0, places=5)
        self.assertEqual(metrics["bpm_absolute_error"], 0.0)

    def test_robustness_transforms_preserve_shape_and_sample_rate_contract(self) -> None:
        sample_rate = 44_100
        duration_seconds = 1.25
        frame_count = int(sample_rate * duration_seconds)
        time = np.arange(frame_count, dtype=np.float32) / sample_rate
        mono = 0.2 * np.sin(2.0 * np.pi * 440.0 * time)
        samples = np.stack([mono, mono], axis=0).astype(np.float32)

        variants = _build_variants()
        self.assertEqual(
            set(variants),
            {"gain_minus_6db", "low_noise", "highpass_35hz", "lowpass_16khz"},
        )

        for name, transform in variants.items():
            transformed = transform(samples=samples.copy(), sample_rate=sample_rate)
            self.assertEqual(transformed.shape, samples.shape, name)
            self.assertTrue(np.isfinite(transformed).all(), name)

    def test_generated_audio_shape_round_trips_through_soundfile(self) -> None:
        sample_rate = 44_100
        samples = np.zeros((sample_rate // 4, 2), dtype=np.float32)
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "fixture.wav"
            sf.write(path, samples, sample_rate, subtype="PCM_24")
            decoded, decoded_rate = sf.read(path, always_2d=True, dtype="float32")

        self.assertEqual(decoded_rate, sample_rate)
        self.assertEqual(decoded.shape, samples.shape)


if __name__ == "__main__":
    unittest.main()
