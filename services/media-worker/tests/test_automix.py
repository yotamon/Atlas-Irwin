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

from app.automix_dsp import _apply_ceiling, _channel_gain_db, _scan_peaks, _stretch_audio, mix_transition
from app.automix_intelligence import mastering_profile, tempo_profile
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
        extra_map: dict | None = None,
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
        timeline = [
            {"ms": ms, "bpm": bpm, "deviation_bpm": 0.0}
            for ms in range(0, 180_001, 5_000)
        ]
        music_map = {
            "duration_ms": 180_000,
            "beat_stability": {
                "classification": "stable",
                "confidence": 0.95,
                "local_jitter_bpm": 0.15,
                "timeline": timeline,
            },
            "master_qc": {
                "technical_ready": True,
                "integrated_lufs": -10.0,
                "true_peak_dbtp": -1.0,
                "clipping_ratio": 0.0,
            },
            "sections": [
                {"start_ms": 0, "end_ms": 90_000, "label": label, "confidence": 0.9},
                {"start_ms": 90_000, "end_ms": 180_000, "label": "outro", "confidence": 0.9},
            ],
        }
        if extra_map:
            music_map.update(extra_map)
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

    def test_time_factor_above_one_speeds_up_and_shortens_audio(self) -> None:
        audio = np.zeros((SAMPLE_RATE, 2), dtype=np.float32)
        playback_rate = 1.05
        rendered = _stretch_audio(audio, playback_rate)
        expected = int(round(len(audio) / playback_rate))
        self.assertLess(len(rendered), len(audio))
        self.assertLessEqual(abs(len(rendered) - expected), 1)

    def test_large_tempo_gap_is_not_forced_into_beatmatch(self) -> None:
        a = self._track("slow", 90, "4A", 0.55)
        b = self._track("fast", 135, "10B", 0.70)
        metrics = transition_score(a, b, 0.5, "booking", "dynamic")
        technique, bars, beatmatch, reasons = choose_transition(a, b, metrics, "dj")
        self.assertFalse(beatmatch)
        self.assertEqual(bars, 0)
        self.assertIn(technique, {"echo_out", "drop_cut"})
        self.assertTrue(reasons)

    def test_unstable_tempo_is_never_flattened_to_a_fixed_grid(self) -> None:
        unstable = self._track("live-feel", 120, "8A", 0.62)
        unstable.music_map["beat_stability"] = {
            "classification": "unstable",
            "confidence": 0.96,
            "local_jitter_bpm": 3.4,
            "timeline": [
                {"ms": 0, "bpm": 116.0},
                {"ms": 15_000, "bpm": 123.0},
                {"ms": 30_000, "bpm": 118.0},
                {"ms": 45_000, "bpm": 126.0},
                {"ms": 60_000, "bpm": 117.0},
                {"ms": 75_000, "bpm": 124.0},
            ],
        }
        stable = self._track("grid", 122, "8A", 0.65)
        profile = tempo_profile(unstable.music_map, 0, 90_000, 120.0)
        self.assertEqual(profile["classification"], "unstable")
        self.assertFalse(profile["constant_stretch_safe"])
        plan = build_plan([unstable, stable], "journey", "dynamic", "dj", 6 * 60 * 1000)
        self.assertEqual(float(plan["tracks"][0]["time_factor"]), 1.0)
        self.assertFalse(plan["transitions"][0]["beatmatch"])
        self.assertEqual(plan["transitions"][0]["technique"], "echo_out")

    def test_section_tempo_change_can_use_local_stable_window(self) -> None:
        changing = self._track("tempo-change", 120, "8A", 0.6, start_ms=90_000, end_ms=180_000)
        changing.music_map["beat_stability"] = {
            "classification": "section_tempo_changes",
            "confidence": 0.93,
            "local_jitter_bpm": 0.2,
            "timeline": [
                *[{"ms": ms, "bpm": 118.0} for ms in range(0, 90_000, 5_000)],
                *[{"ms": ms, "bpm": 124.0} for ms in range(90_000, 181_000, 5_000)],
            ],
        }
        profile = tempo_profile(changing.music_map, 90_000, 180_000, 120.0)
        self.assertEqual(profile["classification"], "section_tempo_changes")
        self.assertTrue(profile["constant_stretch_safe"])
        self.assertAlmostEqual(float(profile["window_bpm"]), 124.0, places=1)

    def test_vocal_collision_vetoes_long_harmonic_blend(self) -> None:
        vocal_curve = [
            {"start_ms": ms, "end_ms": ms + 500, "energy": 0.9, "active_ratio": 0.95, "active": True}
            for ms in range(0, 180_000, 500)
        ]
        a = self._track("vocal-a", 122, "8A", 0.64, extra_map={"automix_vocals_activity_curve": vocal_curve})
        b = self._track("vocal-b", 122, "8A", 0.66, extra_map={"automix_vocals_activity_curve": vocal_curve})
        metrics = transition_score(a, b, 0.5, "booking", "dynamic")
        technique, bars, beatmatch, reasons = choose_transition(a, b, metrics, "dj")
        self.assertGreater(metrics["vocal_collision"], 0.3)
        self.assertTrue(beatmatch)
        self.assertEqual(technique, "quick_mix")
        self.assertEqual(bars, 4)
        self.assertTrue(any("vocal" in reason for reason in reasons))

    def test_clipped_master_is_not_boosted_to_chase_loudness(self) -> None:
        poor = mastering_profile({
            "master_qc": {
                "technical_ready": False,
                "integrated_lufs": -15.0,
                "true_peak_dbtp": 0.2,
                "clipping_ratio": 0.001,
            },
        })
        clean = mastering_profile({
            "master_qc": {
                "technical_ready": True,
                "integrated_lufs": -15.0,
                "true_peak_dbtp": -3.0,
                "clipping_ratio": 0.0,
            },
        })
        self.assertEqual(_channel_gain_db(-15.0, -10.0, poor), 0.0)
        self.assertGreater(_channel_gain_db(-15.0, -10.0, clean), 0.0)
        self.assertGreater(clean["quality_score"], poor["quality_score"])

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
