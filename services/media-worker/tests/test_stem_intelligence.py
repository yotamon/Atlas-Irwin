from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf


MODULE_PATH = Path(__file__).resolve().parents[1] / "app" / "stem_intelligence.py"
SPEC = importlib.util.spec_from_file_location("atlas_stem_intelligence_test_module", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Could not load Atlas stem intelligence module")
stem_intelligence = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = stem_intelligence
SPEC.loader.exec_module(stem_intelligence)


class StemIntelligenceTest(unittest.TestCase):
    def test_alignment_finds_an_irregular_delayed_pattern(self) -> None:
        sr = stem_intelligence.TARGET_SR
        duration_seconds = 7.0
        samples = int(sr * duration_seconds)
        master = np.zeros(samples, dtype=np.float32)
        burst_length = int(sr * 0.025)
        window = np.hanning(burst_length).astype(np.float32)
        for second, amplitude in [(0.42, 0.9), (1.17, 0.5), (2.63, 1.0), (4.08, 0.7), (5.71, 0.85)]:
            start = int(second * sr)
            master[start:start + burst_length] += amplitude * window

        delay_seconds = 0.48
        delay_samples = int(delay_seconds * sr)
        delayed = np.zeros_like(master)
        delayed[delay_samples:] = master[:-delay_samples]
        alignment = stem_intelligence._alignment(master, delayed, sr, 0)

        self.assertGreaterEqual(alignment["timeline_confidence"], 0.5)
        self.assertGreaterEqual(alignment["signal_correlation_confidence"], 0.32)
        self.assertEqual(alignment["method"], "onset_cross_correlation")
        self.assertLessEqual(abs(abs(alignment["offset_ms"]) - 480), 80)
        self.assertEqual(alignment["confidence"], alignment["timeline_confidence"])

    def test_sparse_same_duration_stem_keeps_high_timeline_confidence_without_fake_signal_confidence(self) -> None:
        sr = stem_intelligence.TARGET_SR
        samples = sr * 5
        master = np.zeros(samples, dtype=np.float32)
        stem = np.zeros(samples, dtype=np.float32)
        master[int(1.0 * sr):int(1.03 * sr)] = 0.6
        stem[int(3.0 * sr):int(3.03 * sr)] = 0.4
        alignment = stem_intelligence._alignment(master, stem, sr, 0)

        self.assertGreaterEqual(alignment["timeline_confidence"], 0.65)
        self.assertLess(alignment["signal_correlation_confidence"], alignment["timeline_confidence"])
        self.assertEqual(alignment["offset_ms"], 0)
        self.assertIn("duration_match", alignment["evidence"])

    def test_synthetic_stem_produces_role_aware_metrics_master_clock_and_activity_curve(self) -> None:
        sr = stem_intelligence.TARGET_SR
        duration_seconds = 8.0
        samples = int(sr * duration_seconds)
        t = np.arange(samples, dtype=np.float32) / sr
        master = 0.04 * np.sin(2 * np.pi * 110 * t)
        stem = 0.025 * np.sin(2 * np.pi * 220 * t)
        pulse_length = int(sr * 0.03)
        pulse = np.hanning(pulse_length).astype(np.float32)
        for index, beat_second in enumerate(np.arange(0.0, duration_seconds, 0.5)):
            start = int(beat_second * sr)
            end = min(samples, start + pulse_length)
            master[start:end] += (0.45 if index % 4 == 0 else 0.28) * pulse[: end - start]
            stem[start:end] += (0.34 if index % 4 == 0 else 0.22) * pulse[: end - start]
        stereo_master = np.stack([master, master * 0.97], axis=1)
        stereo_stem = np.stack([stem, stem * 0.95], axis=1)
        sections = [
            {"id": "a", "label": "Intro", "start_ms": 0, "end_ms": 4000},
            {"id": "b", "label": "Groove", "start_ms": 4000, "end_ms": 8000},
        ]

        with tempfile.TemporaryDirectory(prefix="atlas-stem-test-") as directory:
            root = Path(directory)
            master_path = root / "master.wav"
            stem_path = root / "drums.wav"
            sf.write(master_path, stereo_master, sr, subtype="PCM_16")
            sf.write(stem_path, stereo_stem, sr, subtype="PCM_16")
            analysis = stem_intelligence.analyze_stem(stem_path, master_path, "drums", sections)

        self.assertEqual(analysis["version"], 2)
        self.assertEqual(analysis["engine"], "atlas_stem_intelligence_v2")
        self.assertEqual(analysis["category"], "drums")
        for signal in (
            "energy",
            "active_ratio",
            "rhythmic_activity",
            "groove_score",
            "loopability",
            "hook_score",
            "spectral_motion",
        ):
            self.assertIn(signal, analysis["summary"])
            self.assertGreaterEqual(analysis["summary"][signal], 0.0)
            self.assertLessEqual(analysis["summary"][signal], 1.0)
        self.assertNotIn("tonal_focus", analysis["summary"], "drum metrics should not expose misleading tonal-focus semantics")

        self.assertIsNotNone(analysis["tempo"]["canonical_bpm"])
        self.assertEqual(analysis["tempo"]["bpm"], analysis["tempo"]["canonical_bpm"])
        self.assertEqual(analysis["tempo"]["canonical_source"], "master_audio")
        self.assertIn("observed_stem_bpm", analysis["tempo"])
        self.assertGreaterEqual(analysis["tempo"]["tempo_agreement"], 0.0)
        self.assertLessEqual(analysis["tempo"]["tempo_agreement"], 1.0)

        self.assertEqual(len(analysis["section_activity"]), 2)
        self.assertGreaterEqual(len(analysis["activity_curve"]), 8)
        self.assertTrue(analysis["best_moments"])
        for moment in analysis["best_moments"]:
            self.assertLess(moment["score"], 1.0, "window normalization should not produce meaningless perfect scores")
        self.assertIn(analysis["alignment"]["method"], {"onset_cross_correlation", "duration_plus_sparse_signal", "duration_evidence"})
        self.assertGreaterEqual(analysis["alignment"]["timeline_confidence"], 0.0)
        self.assertLessEqual(analysis["alignment"]["timeline_confidence"], 1.0)
        self.assertEqual(analysis["technical"]["analysis_sample_rate"], sr)
        self.assertEqual(analysis["technical"]["source_sample_rate"], sr)
        self.assertEqual(analysis["technical"]["source_channels"], 2)
        self.assertLessEqual(abs(analysis["technical"]["duration_ms"] - 8000), 2)
        self.assertEqual(analysis["provenance"]["canonical_clock"], "master_audio")


if __name__ == "__main__":
    unittest.main()
