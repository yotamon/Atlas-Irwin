from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.automix_model import MusicalKey, TrackDescriptor, normalize_dj_bpm
from app.automix_set_intelligence import (
    normalize_dj_profile,
    preferred_transition_style,
    select_tracks_for_set,
)


class AutoMixSetIntelligenceTest(unittest.TestCase):
    def _track(self, index: int, *, bpm: float | None = None, energy: float | None = None) -> TrackDescriptor:
        bpm_value = bpm if bpm is not None else 118.0 + index
        energy_value = energy if energy is not None else 0.42 + index * 0.045
        camelot = f"{(index % 12) + 1}A"
        key = MusicalKey(
            root_pc=index % 12,
            mode="minor",
            confidence=0.9,
            camelot=camelot,
            label=f"Key {camelot}",
        )
        return TrackDescriptor(
            id=f"track-{index}",
            title=f"Track {index}",
            url=f"https://example.com/{index}.wav",
            path=Path(f"/{index}.wav"),
            music_map={
                "duration_ms": 240_000,
                "master_qc": {
                    "technical_ready": True,
                    "integrated_lufs": -10.0,
                    "true_peak_dbtp": -1.0,
                    "clipping_ratio": 0.0,
                },
            },
            duration_ms=240_000,
            bpm=bpm_value,
            dj_bpm=normalize_dj_bpm(bpm_value),
            key=key,
            energy=energy_value,
            loudness_lufs=-10.0,
            window_start_ms=30_000,
            window_end_ms=150_000,
            window_score=max(0.45, 0.92 - index * 0.035),
        )

    def test_duration_aware_curation_can_omit_weaker_candidates(self) -> None:
        tracks = [self._track(index) for index in range(8)]
        result = select_tracks_for_set(
            tracks,
            purpose="booking",
            energy_profile="dynamic",
            target_duration_ms=6 * 60 * 1000,
        )
        self.assertLess(len(result["tracks"]), len(tracks))
        self.assertEqual(result["summary"]["candidate_count"], 8)
        self.assertTrue(result["summary"]["duration_aware_curation"])
        self.assertEqual(result["summary"]["omitted_count"], len(tracks) - len(result["tracks"]))

    def test_must_play_survives_duration_curation(self) -> None:
        tracks = [self._track(index) for index in range(8)]
        result = select_tracks_for_set(
            tracks,
            purpose="booking",
            energy_profile="dynamic",
            target_duration_ms=5 * 60 * 1000,
            set_intent={"must_play_track_ids": ["track-7"]},
        )
        selected_ids = {track.id for track in result["tracks"]}
        self.assertIn("track-7", selected_ids)
        self.assertIn("required by Set Intent", result["selection_reasons"]["track-7"])

    def test_journey_defaults_to_preserving_the_candidate_pool(self) -> None:
        tracks = [self._track(index) for index in range(7)]
        result = select_tracks_for_set(
            tracks,
            purpose="journey",
            energy_profile="dynamic",
            target_duration_ms=4 * 60 * 1000,
        )
        self.assertEqual([track.id for track in result["tracks"]], [track.id for track in tracks])
        self.assertFalse(result["set_intent"]["allow_omissions"])

    def test_conflicting_hard_constraints_fail_instead_of_silently_ignoring_them(self) -> None:
        tracks = [self._track(index) for index in range(4)]
        with self.assertRaisesRegex(ValueError, "both require and block"):
            select_tracks_for_set(
                tracks,
                purpose="booking",
                energy_profile="dynamic",
                target_duration_ms=6 * 60 * 1000,
                set_intent={
                    "must_play_track_ids": ["track-1"],
                    "blocked_track_ids": ["track-1"],
                },
            )

    def test_must_play_bpm_conflict_is_reported(self) -> None:
        tracks = [self._track(0, bpm=96), self._track(1, bpm=124), self._track(2, bpm=126)]
        with self.assertRaisesRegex(ValueError, "below the requested BPM range"):
            select_tracks_for_set(
                tracks,
                purpose="booking",
                energy_profile="dynamic",
                target_duration_ms=6 * 60 * 1000,
                set_intent={"must_play_track_ids": ["track-0"], "min_bpm": 110},
            )

    def test_personal_profile_only_reinterprets_neutral_dj_style(self) -> None:
        conservative = normalize_dj_profile({"transition_aggressiveness": 0.1})
        adventurous = normalize_dj_profile({"transition_aggressiveness": 0.9})
        self.assertEqual(preferred_transition_style("dj", conservative), "clean")
        self.assertEqual(preferred_transition_style("dj", adventurous), "creative")
        self.assertEqual(preferred_transition_style("clean", adventurous), "clean")
        self.assertEqual(preferred_transition_style("creative", conservative), "creative")


if __name__ == "__main__":
    unittest.main()
