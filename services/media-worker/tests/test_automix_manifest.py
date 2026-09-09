from __future__ import annotations

import copy
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.automix_manifest import MIXPLAN_VERSION, build_mixplan, mixplan_hash, validate_mixplan
from app.automix_mixplan_renderer import render_mixplan
from app.automix_model import MusicalKey, TrackDescriptor


class MixPlanManifestTest(unittest.TestCase):
    def _legacy_plan(self) -> dict:
        return {
            "version": "ensemblis.automix.v1",
            "purpose": "booking",
            "energy_profile": "dynamic",
            "transition_style": "dj",
            "requested_duration_ms": 180_000,
            "estimated_duration_ms": 172_000,
            "tracks": [
                {
                    "track_id": "a",
                    "title": "A",
                    "source_start_ms": 10_000,
                    "source_end_ms": 100_000,
                    "source_bpm": 122.0,
                    "dj_bpm": 122.0,
                    "playback_bpm": 123.0,
                    "time_factor": 1.0081967,
                    "tempo": {"classification": "stable"},
                    "mastering": {"quality_score": 0.94},
                    "key": {"camelot": "8A", "confidence": 0.9},
                    "energy": 0.58,
                    "window_score": 0.9,
                },
                {
                    "track_id": "b",
                    "title": "B",
                    "source_start_ms": 20_000,
                    "source_end_ms": 110_000,
                    "source_bpm": 124.0,
                    "dj_bpm": 124.0,
                    "playback_bpm": 123.0,
                    "time_factor": 0.9919355,
                    "tempo": {"classification": "stable"},
                    "mastering": {"quality_score": 0.92},
                    "key": {"camelot": "9A", "confidence": 0.91},
                    "energy": 0.68,
                    "window_score": 0.88,
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
                    "score": 0.86,
                    "confidence": 0.82,
                    "risk_flags": [],
                    "fallback": {"technique": "quick_mix", "bars": 4},
                },
            ],
            "quality_contract": {"pitch_shift_semitones": 0, "master_preservation": True},
            "quality_summary": {"transition_count": 1, "mean_confidence": 0.82},
        }

    def test_builder_creates_stable_versioned_render_contract(self) -> None:
        manifest = build_mixplan(self._legacy_plan(), source_fingerprints=[{"track_id": "a", "hash": "x"}])
        self.assertEqual(manifest["version"], MIXPLAN_VERSION)
        self.assertEqual(manifest["execution_contract"], "offline_audio_render")
        self.assertEqual(manifest["tracks"][0]["source"], {"start_ms": 10_000, "end_ms": 100_000})
        self.assertEqual(manifest["tracks"][0]["playback"]["pitch_shift_semitones"], 0.0)
        self.assertEqual(manifest["transitions"][0]["automation"]["duration_ms"], 8_000)
        self.assertEqual(len(manifest["plan_hash"]), 64)
        self.assertEqual(manifest["plan_hash"], mixplan_hash(manifest))
        validate_mixplan(manifest)

    def test_track_reorder_without_transition_rewrite_is_rejected(self) -> None:
        manifest = build_mixplan(self._legacy_plan())
        manifest["tracks"].reverse()
        with self.assertRaisesRegex(ValueError, "endpoints"):
            validate_mixplan(manifest)

    def test_destructive_playback_rate_is_rejected_before_render(self) -> None:
        manifest = build_mixplan(self._legacy_plan())
        manifest["tracks"][0]["playback"]["time_factor"] = 1.09
        with self.assertRaisesRegex(ValueError, "playback-rate"):
            validate_mixplan(manifest)

    def test_oversized_overlap_is_rejected(self) -> None:
        manifest = build_mixplan(self._legacy_plan())
        manifest["transitions"][0]["overlap_ms"] = 60_000
        manifest["transitions"][0]["automation"]["duration_ms"] = 60_000
        with self.assertRaisesRegex(ValueError, "overlap"):
            validate_mixplan(manifest)

    def test_automation_must_be_ordered_and_bounded(self) -> None:
        manifest = build_mixplan(self._legacy_plan())
        manifest["transitions"][0]["automation"]["from_gain"] = [
            {"at": 0.8, "value": 1.0},
            {"at": 0.2, "value": 0.0},
        ]
        with self.assertRaisesRegex(ValueError, "ordered"):
            validate_mixplan(manifest)

    def test_manifest_hash_prevents_render_instruction_tampering(self) -> None:
        manifest = build_mixplan(self._legacy_plan())
        tampered = copy.deepcopy(manifest)
        tampered["transitions"][0]["technique"] = "harmonic_blend"
        tracks = [self._descriptor("a"), self._descriptor("b")]
        with tempfile.TemporaryDirectory(prefix="mixplan-hash-") as directory:
            with self.assertRaisesRegex(ValueError, "hash"):
                render_mixplan(tracks, tampered, Path(directory))

    def test_renderer_rejects_unavailable_source_before_dsp(self) -> None:
        manifest = build_mixplan(self._legacy_plan())
        tracks = [self._descriptor("a")]
        with tempfile.TemporaryDirectory(prefix="mixplan-source-") as directory:
            with self.assertRaisesRegex(ValueError, "unavailable"):
                render_mixplan(tracks, manifest, Path(directory))

    def _descriptor(self, track_id: str) -> TrackDescriptor:
        return TrackDescriptor(
            id=track_id,
            title=track_id.upper(),
            url=f"https://example.com/{track_id}.wav",
            path=Path(f"/{track_id}.wav"),
            music_map={"duration_ms": 120_000},
            duration_ms=120_000,
            bpm=123.0,
            dj_bpm=123.0,
            key=MusicalKey(0, "minor", 0.9, "5A", "C minor"),
            energy=0.6,
            loudness_lufs=-10.0,
            window_start_ms=0,
            window_end_ms=90_000,
            window_score=0.9,
        )


if __name__ == "__main__":
    unittest.main()
