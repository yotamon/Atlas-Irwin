from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.automix_manifest_personalized import build_mixplan
from app.automix_model import MusicalKey, TrackDescriptor, normalize_dj_bpm
from app.automix_planner_personalized import build_set_intelligent_plan
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
        timeline = [
            {"ms": ms, "bpm": bpm_value, "deviation_bpm": 0.0}
            for ms in range(0, 240_001, 5_000)
        ]
        return TrackDescriptor(
            id=f"track-{index}",
            title=f"Track {index}",
            url=f"https://example.com/{index}.wav",
            path=Path(f"/{index}.wav"),
            music_map={
                "duration_ms": 240_000,
                "beat_stability": {
                    "classification": "stable",
                    "confidence": 0.96,
                    "local_jitter_bpm": 0.1,
                    "timeline": timeline,
                },
                "master_qc": {
                    "technical_ready": True,
                    "integrated_lufs": -10.0,
                    "true_peak_dbtp": -1.0,
                    "clipping_ratio": 0.0,
                },
                "sections": [
                    {"start_ms": 0, "end_ms": 60_000, "label": "intro", "confidence": 0.92, "boundary_confidence": 0.92},
                    {"start_ms": 60_000, "end_ms": 180_000, "label": "groove", "confidence": 0.9, "boundary_confidence": 0.9},
                    {"start_ms": 180_000, "end_ms": 240_000, "label": "outro", "confidence": 0.93, "boundary_confidence": 0.93},
                ],
                "phrases": [
                    {"start_ms": 60_000, "end_ms": 120_000, "confidence": 0.9},
                    {"start_ms": 120_000, "end_ms": 180_000, "confidence": 0.9},
                ],
                "downbeat_source": "model",
                "downbeats_ms": list(range(0, 240_001, 2_000)),
                "moments": {
                    "musical_identity": [
                        {"start_ms": 90_000, "end_ms": 120_000, "score": max(0.45, 0.92 - index * 0.035)},
                    ],
                    "story_arc": [
                        {"start_ms": 90_000, "end_ms": 120_000, "score": max(0.45, 0.9 - index * 0.03)},
                    ],
                },
            },
            duration_ms=240_000,
            bpm=bpm_value,
            dj_bpm=normalize_dj_bpm(bpm_value),
            key=key,
            energy=energy_value,
            loudness_lufs=-10.0,
            window_start_ms=60_000,
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

    def test_journey_preserves_every_candidate_even_if_client_requests_omissions(self) -> None:
        tracks = [self._track(index) for index in range(7)]
        result = select_tracks_for_set(
            tracks,
            purpose="journey",
            energy_profile="dynamic",
            target_duration_ms=4 * 60 * 1000,
            set_intent={"allow_omissions": True, "target_track_count": 2, "must_play_track_ids": ["track-0"]},
        )
        self.assertEqual([track.id for track in result["tracks"]], [track.id for track in tracks])
        self.assertFalse(result["set_intent"]["allow_omissions"])
        self.assertEqual(result["set_intent"]["target_track_count"], len(tracks))
        self.assertEqual(result["set_intent"]["must_play_track_ids"], [track.id for track in tracks])
        self.assertEqual(result["summary"]["must_play_count"], len(tracks))

    def test_journey_hard_filter_conflicts_fail_instead_of_changing_the_story(self) -> None:
        tracks = [self._track(0, bpm=96), self._track(1, bpm=124), self._track(2, bpm=126)]
        with self.assertRaisesRegex(ValueError, "below the requested BPM range"):
            select_tracks_for_set(
                tracks,
                purpose="journey",
                energy_profile="dynamic",
                target_duration_ms=6 * 60 * 1000,
                set_intent={"min_bpm": 110},
            )

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

    def test_profile_v2_normalizes_movement_preferences_without_expanding_safety(self) -> None:
        profile = normalize_dj_profile({
            "tempo_movement": 3.0,
            "energy_dynamics": -1.0,
            "learned_confidence": 0.7,
            "evidence_count": 12,
        })
        self.assertEqual(profile["version"], "ensemblis.dj-profile.v2")
        self.assertEqual(profile["tempo_movement"], 1.0)
        self.assertEqual(profile["energy_dynamics"], 0.0)
        self.assertEqual(profile["learned_confidence"], 0.7)
        self.assertEqual(profile["evidence_count"], 12)

    def test_selected_tracks_are_rewindowed_after_duration_curation(self) -> None:
        tracks = [self._track(index) for index in range(8)]
        initial_window_ms = tracks[0].window_end_ms - tracks[0].window_start_ms
        plan = build_set_intelligent_plan(
            tracks,
            "booking",
            "dynamic",
            "dj",
            6 * 60 * 1000,
            set_intent={"target_track_count": 3},
        )
        self.assertEqual(plan["selection_summary"]["selected_count"], 3)
        rendered_windows = [
            int(item["source_end_ms"]) - int(item["source_start_ms"])
            for item in plan["tracks"]
        ]
        self.assertTrue(any(window > initial_window_ms for window in rendered_windows))
        self.assertTrue(plan["quality_contract"]["post_curation_window_resizing"])

    def test_personalized_mixplan_hashes_planning_provenance(self) -> None:
        tracks = [self._track(index) for index in range(5)]
        plan = build_set_intelligent_plan(
            tracks,
            "booking",
            "dynamic",
            "dj",
            5 * 60 * 1000,
            set_intent={"must_play_track_ids": ["track-4"], "target_track_count": 3},
            dj_profile={
                "harmonic_adventure": 0.72,
                "transition_aggressiveness": 0.55,
                "exploration": 0.7,
                "tempo_movement": 0.6,
                "energy_dynamics": 0.65,
            },
        )
        manifest = build_mixplan(plan, source_fingerprints=[])
        self.assertEqual(manifest["set_intent"]["version"], "ensemblis.set-intent.v1")
        self.assertEqual(manifest["dj_profile"]["version"], "ensemblis.dj-profile.v2")
        self.assertEqual(manifest["selection_summary"]["selected_count"], 3)
        self.assertEqual(manifest["requested_transition_style"], "dj")
        self.assertTrue(isinstance(manifest.get("plan_hash"), str) and len(manifest["plan_hash"]) == 64)


if __name__ == "__main__":
    unittest.main()
