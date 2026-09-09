from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.automix_manifest_personalized import build_mixplan
from app.automix_model import MusicalKey, TrackDescriptor, normalize_dj_bpm
from app.automix_plan_directives import normalize_plan_directives
from app.automix_planner_personalized import build_set_intelligent_plan


class AutoMixPlanDirectivesTest(unittest.TestCase):
    def _track(self, index: int, *, bpm: float | None = None) -> TrackDescriptor:
        bpm_value = bpm if bpm is not None else 116.0 + index * 1.5
        camelot = f"{(index % 12) + 1}A"
        key = MusicalKey(
            root_pc=index % 12,
            mode="minor",
            confidence=0.92,
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
                    "confidence": 0.97,
                    "local_jitter_bpm": 0.08,
                    "timeline": timeline,
                },
                "master_qc": {
                    "technical_ready": True,
                    "integrated_lufs": -10.0,
                    "true_peak_dbtp": -1.0,
                    "clipping_ratio": 0.0,
                },
                "sections": [
                    {"start_ms": 0, "end_ms": 60_000, "label": "intro", "confidence": 0.95, "boundary_confidence": 0.95},
                    {"start_ms": 60_000, "end_ms": 180_000, "label": "groove", "confidence": 0.94, "boundary_confidence": 0.94},
                    {"start_ms": 180_000, "end_ms": 240_000, "label": "outro", "confidence": 0.95, "boundary_confidence": 0.95},
                ],
                "phrases": [
                    {"start_ms": 60_000, "end_ms": 120_000, "confidence": 0.94},
                    {"start_ms": 120_000, "end_ms": 180_000, "confidence": 0.94},
                ],
                "downbeat_source": "model",
                "downbeats_ms": list(range(0, 240_001, 2_000)),
                "moments": {
                    "musical_identity": [
                        {"start_ms": 90_000, "end_ms": 120_000, "score": max(0.48, 0.94 - index * 0.025)},
                    ],
                    "story_arc": [
                        {"start_ms": 90_000, "end_ms": 120_000, "score": max(0.48, 0.92 - index * 0.02)},
                    ],
                },
            },
            duration_ms=240_000,
            bpm=bpm_value,
            dj_bpm=normalize_dj_bpm(bpm_value),
            key=key,
            energy=0.38 + index * 0.07,
            loudness_lufs=-10.0,
            window_start_ms=60_000,
            window_end_ms=150_000,
            window_score=max(0.48, 0.94 - index * 0.025),
        )

    def test_directives_reject_duplicate_locked_positions(self) -> None:
        tracks = [self._track(index) for index in range(4)]
        with self.assertRaisesRegex(ValueError, "locked to position"):
            normalize_plan_directives({
                "locked_positions": [
                    {"track_id": "track-0", "position": 1},
                    {"track_id": "track-1", "position": 1},
                ],
            }, tracks)

    def test_position_lock_survives_curation_and_is_hard(self) -> None:
        tracks = [self._track(index) for index in range(8)]
        plan = build_set_intelligent_plan(
            tracks,
            "booking",
            "dynamic",
            "dj",
            6 * 60 * 1000,
            set_intent={"target_track_count": 3},
            plan_directives={
                "variant": "recommended",
                "locked_positions": [{"track_id": "track-7", "position": 2}],
            },
        )
        self.assertEqual(plan["selection_summary"]["selected_count"], 3)
        self.assertEqual(plan["tracks"][2]["track_id"], "track-7")
        self.assertTrue(plan["tracks"][2]["position_locked"])
        self.assertIn("track-7", plan["set_intent"]["must_play_track_ids"])

    def test_lock_can_expand_target_count_when_required_position_is_later(self) -> None:
        tracks = [self._track(index) for index in range(8)]
        plan = build_set_intelligent_plan(
            tracks,
            "booking",
            "dynamic",
            "dj",
            8 * 60 * 1000,
            set_intent={"target_track_count": 2},
            plan_directives={
                "locked_positions": [{"track_id": "track-7", "position": 4}],
            },
        )
        self.assertGreaterEqual(plan["selection_summary"]["selected_count"], 5)
        self.assertEqual(plan["tracks"][4]["track_id"], "track-7")

    def test_unsafe_transition_override_fails_closed(self) -> None:
        tracks = [self._track(0, bpm=96.0), self._track(1, bpm=128.0)]
        with self.assertRaisesRegex(ValueError, "Quick-mix override is unsafe"):
            build_set_intelligent_plan(
                tracks,
                "booking",
                "dynamic",
                "dj",
                4 * 60 * 1000,
                set_intent={"allow_omissions": False},
                plan_directives={
                    "transition_overrides": [{
                        "from_track_id": "track-0",
                        "to_track_id": "track-1",
                        "technique": "quick_mix",
                    }],
                },
            )

    def test_variant_and_lineage_are_hashed_into_mixplan_provenance(self) -> None:
        tracks = [self._track(index) for index in range(5)]
        plan = build_set_intelligent_plan(
            tracks,
            "booking",
            "dynamic",
            "dj",
            7 * 60 * 1000,
            set_intent={"allow_omissions": False},
            plan_directives={"variant": "safe"},
        )
        plan["plan_lineage"] = {
            "version": "ensemblis.plan-lineage.v1",
            "root_job_id": "root-plan",
            "parent_job_id": None,
            "revision": 1,
            "operation": "create",
        }
        manifest = build_mixplan(plan, source_fingerprints=[])
        self.assertEqual(manifest["plan_variant"], "safe")
        self.assertEqual(manifest["plan_directives"]["version"], "ensemblis.plan-directives.v1")
        self.assertEqual(manifest["plan_lineage"]["root_job_id"], "root-plan")
        self.assertTrue(isinstance(manifest.get("plan_hash"), str) and len(manifest["plan_hash"]) == 64)


if __name__ == "__main__":
    unittest.main()
