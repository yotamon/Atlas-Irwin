from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf


MODULE_PATH = Path(__file__).resolve().parents[1] / "app" / "music_intelligence.py"
SPEC = importlib.util.spec_from_file_location("atlas_music_intelligence_test_module", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Could not load Atlas music intelligence module")
music_intelligence = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = music_intelligence
SPEC.loader.exec_module(music_intelligence)


class TrackIntelligenceV3Test(unittest.TestCase):
    def test_intent_scores_are_not_one_universal_hook_score(self) -> None:
        base = {
            "energy": 0.55,
            "energy_lift": 0.50,
            "novelty": 0.50,
            "onset_density": 0.50,
            "groove_stability": 0.50,
            "harmonic_distinctiveness": 0.50,
            "boundary_fit": 0.70,
            "boundary_loop_fit": 0.50,
            "structure": 0.65,
            "segment_confidence": 0.70,
            "harmonic_recurrence": 0.50,
            "semantic_recurrence": 0.50,
            "arc_strength": 0.50,
        }
        instant = dict(base, energy_lift=0.98, onset_density=0.95, boundary_loop_fit=0.9)
        story = dict(base, arc_strength=0.98, novelty=0.85, structure=0.92)
        instant_scores = music_intelligence._candidate_intent_scores(instant)
        story_scores = music_intelligence._candidate_intent_scores(story)
        self.assertGreater(instant_scores["instant_hook"], instant_scores["story_arc"])
        self.assertGreater(story_scores["story_arc"], story_scores["instant_hook"])

    def test_synthetic_master_produces_v3_provenance_moments_and_qc(self) -> None:
        # Force the deterministic fallback in CI. Production separately exercises All-In-One;
        # this test protects the DSP/scoring/QC contract without downloading model weights.
        music_intelligence.allin1_infer = None
        sr = 44_100
        duration_seconds = 32.0
        samples = int(sr * duration_seconds)
        t = np.arange(samples, dtype=np.float32) / sr
        audio = 0.08 * np.sin(2 * np.pi * 110 * t)
        audio += 0.035 * np.sin(2 * np.pi * 220 * t)

        # 120 BPM pulse train, with stronger bar starts and an intentional second-half lift.
        pulse_length = int(sr * 0.035)
        pulse_window = np.hanning(pulse_length).astype(np.float32)
        for beat_index, beat_second in enumerate(np.arange(0.0, duration_seconds, 0.5)):
            start = int(beat_second * sr)
            end = min(samples, start + pulse_length)
            amplitude = 0.28 if beat_index % 4 else 0.48
            audio[start:end] += amplitude * pulse_window[: end - start]
        audio[int(12 * sr):int(24 * sr)] *= 1.35
        audio[int(24 * sr):] *= 0.82
        stereo = np.stack([audio, audio * 0.96], axis=1)

        with tempfile.TemporaryDirectory(prefix="atlas-ti-v3-test-") as directory:
            path = Path(directory) / "synthetic-master.wav"
            sf.write(path, stereo, sr, subtype="PCM_16")
            music_map = music_intelligence.analyze_music(
                path,
                {
                    "url": "https://example.com/master.wav",
                    "media_asset_id": "00000000-0000-4000-8000-000000000001",
                    "audio_sha256": "fixture-source-sha",
                    "analysis_pcm_sha256": "fixture-pcm-sha",
                },
            )

        self.assertEqual(music_map["version"], 3)
        self.assertEqual(music_map["source"], "worker")
        self.assertEqual(music_map["source_audio"]["audio_sha256"], "fixture-source-sha")
        self.assertEqual(music_map["analysis"]["config"], "atlas-ti-v3.0.0")
        self.assertFalse(music_map["analysis"]["real_downbeats"])
        self.assertIn(music_map["analysis"]["downbeat_source"], {"inferred_from_beats", "none"})
        self.assertGreaterEqual(music_map["analysis"]["confidence"]["overall"], 0)
        self.assertLessEqual(music_map["analysis"]["confidence"]["overall"], 1)

        self.assertGreater(len(music_map["sections"]), 2)
        self.assertTrue(music_map["energy_curve"])
        self.assertTrue(music_map["hook_candidates"])
        self.assertEqual(
            set(music_map["moments"]),
            {"instant_hook", "musical_identity", "groove_loop", "build_drop", "climax", "story_arc"},
        )
        for duration in ("6", "8", "15", "30"):
            self.assertIn(duration, music_map["social_cuts"])
            self.assertIn(duration, music_map["social_cut_options"])
            self.assertLessEqual(len(music_map["social_cut_options"][duration]), 3)

        candidate = music_map["hook_candidates"][0]
        metrics = candidate["metrics"]
        self.assertAlmostEqual(metrics["repetition"], metrics["semantic_recurrence"])
        self.assertAlmostEqual(metrics["melodic_salience"], metrics["harmonic_distinctiveness"])
        self.assertAlmostEqual(metrics["loopability"], metrics["boundary_loop_fit"])
        self.assertEqual(set(candidate["intent_scores"]), set(music_map["moments"]))

        qc = music_map["master_qc"]
        self.assertTrue(qc["technical_ready"])
        self.assertEqual(qc["sample_rate_hz"], sr)
        self.assertEqual(qc["channels"], 2)
        self.assertIsNotNone(qc["integrated_lufs"])
        self.assertIn("true_peak_dbtp", qc)
        self.assertIn("clipping_samples", qc)
        self.assertIsInstance(qc["issues"], list)


if __name__ == "__main__":
    unittest.main()
