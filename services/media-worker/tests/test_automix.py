from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.automix_dsp import _apply_ceiling, _scan_peaks, mix_transition
from app.automix_model import (
    MAX_BEATMATCH_STRETCH,
    SAMPLE_RATE,
    MusicalKey,
    TrackDescriptor,
    choose_showcase_window,
    harmonic_compatibility,
    normalize_dj_bpm,
)
from app.automix_planner import build_plan, choose_transition, transition_score


class AutoMixEngineTest(unittest.TestCase):
    def _track(
        self,
        track_id: str,
        bpm: float,
        camelot: str,
        energy: float,
        *,
        start_ms: int = 0,
        end_ms: int = 90_000,
        label: str = "instrumental",
    ) -> TrackDescriptor:
        number = int(camelot[:-1])
        letter = camelot[-1]
        key = MusicalKey(
            root_pc=(number - 1) % 12,
            mode="minor" if letter == "A" else "major",
            confidence=0.92,
            camelot=camelot,
            label=f"Key {camelot}",
        )
        music_map = {
            "duration_ms": 180_000,
            "sections": [
                {"start_ms": 0, "end_ms": 90_000, "label": label, "confidence": 0.9},
                {"start_ms": 90_000, "end_ms": 180_000, "label": "outro", "confidence": 0.9},
            ],
        }
        return TrackDescriptor(
            id=track_id,
            title=track_id,
            url=f"https://example.com/{track_id}.wav",
            path=Path(f"/{track_id}.wav"),
            music_map=music_map,
            duration_ms=180_000,
            bpm=bpm,
            dj_bpm=normalize_dj_bpm(bpm),
            key=key,
            energy=energy,
            loudness_lufs=-10.0,
            window_start_ms=start_ms,
            window_end_ms=end_ms,
            window_score=0.85,
        )

    def test_dj_bpm_normalizes_half_and_double_time(self) -> None:
        self.assertAlmostEqual(normalize_dj_bpm(60.0), 120.0)
        self.assertAlmostEqual(normalize_dj_bpm(190.0), 95.0)
        self.assertAlmostEqual(normalize_dj_bpm(124.0), 124.0)

    def test_camelot_same_relative_and_adjacent_are_preferred(self) -> None:
        same = MusicalKey(0, "minor", 0.95, "5A", "C minor")
        relative = MusicalKey(3, "major", 0.95, "5B", "Eb major")
        adjacent = MusicalKey(7, "minor", 0.95, "6A", "G minor")
        distant = MusicalKey(1, "major", 0.95, "11B", "C# major")
        self.assertGreater(harmonic_compatibility(same, relative), 0.85)
        self.assertGreater(harmonic_compatibility(same, adjacent), 0.85)
        self.assertGreater(harmonic_compatibility(same, same), harmonic_compatibility(same, distant))

    def test_showcase_window_uses_ranked_named_moment_and_musical_boundaries(self) -> None:
        music_map = {
            "duration_ms": 120_000,
            "moments": {
                "musical_identity": [
                    {"start_ms": 30_000, "end_ms": 45_000, "score": 0.96, "label": "Identity"},
                ],
            },
            "sections": [
                {"start_ms": 0, "end_ms": 20_000, "label": "intro", "confidence": 0.88},
                {"start_ms": 20_000, "end_ms": 80_000, "label": "verse", "confidence": 0.94},
                {"start_ms": 80_000, "end_ms": 120_000, "label": "outro", "confidence": 0.91},
            ],
            "phrases": [],
            "downbeats_ms": [],
        }
        start, end, score = choose_showcase_window(music_map, 60_000, "booking")
        self.assertLessEqual(start, 30_000)
        self.assertGreaterEqual(end, 45_000)
        self.assertIn(start, {0, 20_000})
        self.assertIn(end, {80_000, 120_000})
        self.assertGreater(score, 0.7)

    def test_journey_mode_preserves_artist_track_order(self) -> None:
        tracks = [
            self._track("opening", 120, "8A", 0.35),
            self._track("middle", 122, "9A", 0.60),
            self._track("closing", 121, "8A", 0.48),
        ]
        plan = build_plan(tracks, "journey", "dynamic", "dj", 12 * 60 * 1000)
        self.assertEqual([item["track_id"] for item in plan["tracks"]], ["opening", "middle", "closing"])
        for item in plan["tracks"]:
            self.assertLessEqual(abs(float(item["time_factor"]) - 1.0), MAX_BEATMATCH_STRETCH + 1e-6)

    def test_large_tempo_gap_is_not_forced_into_beatmatch(self) -> None:
        a = self._track("slow", 90, "4A", 0.55)
        b = self._track("fast", 135, "10B", 0.70)
        metrics = transition_score(a, b, 0.5, "booking", "dynamic")
        technique, bars, beatmatch, reasons = choose_transition(a, b, metrics, "dj")
        self.assertFalse(beatmatch)
        self.assertEqual(bars, 0)
        self.assertIn(technique, {"echo_out", "drop_cut"})
        self.assertTrue(reasons)

    def test_bass_swap_transition_is_finite_and_exact_length(self) -> None:
        seconds = 4
        t = np.arange(SAMPLE_RATE * seconds, dtype=np.float32) / SAMPLE_RATE
        a_mono = 0.22 * np.sin(2 * np.pi * 90 * t) + 0.08 * np.sin(2 * np.pi * 1800 * t)
        b_mono = 0.20 * np.sin(2 * np.pi * 110 * t) + 0.07 * np.sin(2 * np.pi * 2400 * t)
        a = np.stack([a_mono, a_mono * 0.98], axis=1).astype(np.float32)
        b = np.stack([b_mono, b_mono * 0.97], axis=1).astype(np.float32)
        overlap_ms = 2_000
        rendered = mix_transition(a, b, {"technique": "bass_swap", "overlap_ms": overlap_ms}, 120.0)
        self.assertEqual(len(rendered), SAMPLE_RATE * 2)
        self.assertEqual(rendered.shape[1], 2)
        self.assertTrue(np.all(np.isfinite(rendered)))
        self.assertLess(float(np.max(np.abs(rendered))), 1.0)

    def test_finalizer_respects_true_peak_ceiling(self) -> None:
        with tempfile.TemporaryDirectory(prefix="ensemblis-automix-test-") as directory:
            root = Path(directory)
            source = root / "hot.wav"
            target = root / "final.wav"
            t = np.arange(SAMPLE_RATE * 2, dtype=np.float32) / SAMPLE_RATE
            mono = (0.99 * np.sin(2 * np.pi * 997 * t)).astype(np.float32)
            sf.write(source, np.stack([mono, mono], axis=1), SAMPLE_RATE, subtype="FLOAT")
            _, before_true_peak, gain_db = _apply_ceiling(source, target, -1.0)
            _, after_true_peak = _scan_peaks(target)
            ceiling = 10 ** (-1.0 / 20.0)
            self.assertGreater(before_true_peak, ceiling)
            self.assertLess(gain_db, 0.0)
            self.assertLessEqual(after_true_peak, ceiling * 1.006)


if __name__ == "__main__":
    unittest.main()
