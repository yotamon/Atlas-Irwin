from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.automix_manifest import build_mixplan, mixplan_hash, validate_mixplan
from app.automix_preview import _submanifest, _verified_manifest


class AutoMixPreviewTest(unittest.TestCase):
    def _manifest(self) -> dict:
        plan = {
            "version": "ensemblis.automix.v1",
            "purpose": "booking",
            "energy_profile": "dynamic",
            "transition_style": "dj",
            "requested_duration_ms": 240_000,
            "estimated_duration_ms": 230_000,
            "tracks": [
                {
                    "track_id": "a",
                    "title": "A",
                    "source_start_ms": 0,
                    "source_end_ms": 120_000,
                    "source_bpm": 122.0,
                    "dj_bpm": 122.0,
                    "playback_bpm": 122.0,
                    "time_factor": 1.0,
                    "energy": 0.55,
                },
                {
                    "track_id": "b",
                    "title": "B",
                    "source_start_ms": 20_000,
                    "source_end_ms": 140_000,
                    "source_bpm": 122.0,
                    "dj_bpm": 122.0,
                    "playback_bpm": 122.0,
                    "time_factor": 1.0,
                    "energy": 0.65,
                },
                {
                    "track_id": "c",
                    "title": "C",
                    "source_start_ms": 0,
                    "source_end_ms": 120_000,
                    "source_bpm": 124.0,
                    "dj_bpm": 124.0,
                    "playback_bpm": 124.0,
                    "time_factor": 1.0,
                    "energy": 0.72,
                },
            ],
            "transitions": [
                {
                    "from_track_id": "a",
                    "to_track_id": "b",
                    "technique": "bass_swap",
                    "bars": 8,
                    "beatmatch": True,
                    "overlap_ms": 8_000,
                    "score": 0.9,
                    "confidence": 0.88,
                    "risk_flags": [],
                },
                {
                    "from_track_id": "b",
                    "to_track_id": "c",
                    "technique": "quick_mix",
                    "bars": 4,
                    "beatmatch": True,
                    "overlap_ms": 4_000,
                    "score": 0.82,
                    "confidence": 0.8,
                    "risk_flags": ["key_evidence_uncertain"],
                },
            ],
            "quality_contract": {"master_preservation": True},
            "quality_summary": {},
        }
        return build_mixplan(plan, source_fingerprints=[])

    def test_verified_manifest_rejects_tampering(self) -> None:
        manifest = self._manifest()
        self.assertEqual(_verified_manifest(manifest)["plan_hash"], manifest["plan_hash"])
        tampered = {**manifest, "purpose": "peak_time"}
        with self.assertRaisesRegex(ValueError, "intact verified MixPlan hash"):
            _verified_manifest(tampered)

    def test_submanifest_contains_exact_transition_and_rehashes(self) -> None:
        manifest = self._manifest()
        preview = _submanifest(manifest, 1)
        validate_mixplan(preview)
        self.assertEqual([item["track_id"] for item in preview["tracks"]], ["b", "c"])
        self.assertEqual(len(preview["transitions"]), 1)
        self.assertEqual(preview["transitions"][0]["index"], 0)
        self.assertEqual(preview["transitions"][0]["technique"], "quick_mix")
        self.assertEqual(preview["provenance"]["preview_parent_plan_hash"], manifest["plan_hash"])
        self.assertEqual(preview["provenance"]["preview_transition_index"], 1)
        self.assertEqual(preview["plan_hash"], mixplan_hash(preview))

    def test_submanifest_rejects_out_of_range_transition(self) -> None:
        manifest = self._manifest()
        with self.assertRaisesRegex(ValueError, "outside the verified MixPlan"):
            _submanifest(manifest, 7)


if __name__ == "__main__":
    unittest.main()
