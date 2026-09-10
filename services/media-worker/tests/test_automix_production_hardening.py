from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.automix_manifest import (
    RENDER_ENGINE_CONTRACT_VERSION,
    build_mixplan,
    validate_mixplan,
)


class AutoMixProductionHardeningTest(unittest.TestCase):
    def _plan(self) -> dict:
        return {
            "version": "ensemblis.automix.planner-test.v1",
            "purpose": "booking",
            "energy_profile": "dynamic",
            "transition_style": "dj",
            "requested_duration_ms": 120_000,
            "estimated_duration_ms": 116_000,
            "tracks": [
                {
                    "track_id": "track-a",
                    "title": "A",
                    "source_start_ms": 0,
                    "source_end_ms": 60_000,
                    "source_bpm": 120.0,
                    "playback_bpm": 120.0,
                    "time_factor": 1.0,
                },
                {
                    "track_id": "track-b",
                    "title": "B",
                    "source_start_ms": 10_000,
                    "source_end_ms": 70_000,
                    "source_bpm": 121.0,
                    "playback_bpm": 121.0,
                    "time_factor": 1.0,
                },
            ],
            "transitions": [
                {
                    "from_track_id": "track-a",
                    "to_track_id": "track-b",
                    "technique": "drop_cut",
                    "overlap_ms": 0,
                    "beatmatch": False,
                    "confidence": 0.9,
                },
            ],
            "quality_contract": {},
            "quality_summary": {},
        }

    def test_new_mixplan_declares_supported_renderer_contract(self) -> None:
        manifest = build_mixplan(
            self._plan(),
            source_fingerprints=[
                {"track_id": "track-a", "audio_url": "https://example.com/a.wav"},
                {"track_id": "track-b", "audio_url": "https://example.com/b.wav"},
            ],
        )
        self.assertEqual(manifest["render_engine_contract_version"], RENDER_ENGINE_CONTRACT_VERSION)
        validate_mixplan(manifest)

    def test_historical_mixplan_v2_without_renderer_field_stays_reproducible(self) -> None:
        manifest = build_mixplan(self._plan(), source_fingerprints=[])
        manifest.pop("render_engine_contract_version")
        validate_mixplan(manifest)

    def test_unknown_future_renderer_contract_fails_closed(self) -> None:
        manifest = build_mixplan(self._plan(), source_fingerprints=[])
        manifest["render_engine_contract_version"] = "ensemblis.offline-audio-render.v999"
        with self.assertRaisesRegex(ValueError, "Unsupported render engine contract"):
            validate_mixplan(manifest)


if __name__ == "__main__":
    unittest.main()
