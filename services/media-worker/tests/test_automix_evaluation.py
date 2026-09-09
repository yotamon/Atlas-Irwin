from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.automix_evaluation import evaluate_mixplan
from app.automix_manifest import build_mixplan


class AutoMixEvaluationTest(unittest.TestCase):
    def _manifest(self, *, confidence: float = 0.84, bars: int = 8, boundary: float = 0.82, vocal: float = 0.08) -> dict:
        plan = {
            "version": "ensemblis.automix.v1",
            "purpose": "booking",
            "energy_profile": "dynamic",
            "transition_style": "dj",
            "requested_duration_ms": 180_000,
            "estimated_duration_ms": 176_000,
            "tracks": [
                {"track_id": "a", "title": "A", "source_start_ms": 0, "source_end_ms": 90_000, "playback_bpm": 122.0, "time_factor": 1.0},
                {"track_id": "b", "title": "B", "source_start_ms": 0, "source_end_ms": 90_000, "playback_bpm": 122.0, "time_factor": 1.0},
            ],
            "transitions": [{
                "from_track_id": "a",
                "to_track_id": "b",
                "technique": "bass_swap" if bars else "drop_cut",
                "bars": bars,
                "beatmatch": bool(bars),
                "overlap_ms": 8_000 if bars else 0,
                "confidence": confidence,
                "risk_flags": [] if confidence >= 0.58 else ["weak_boundary_evidence"],
                "fallback": {"technique": "quick_mix" if bars else "drop_cut", "bars": 4 if bars else 0},
                "metrics": {
                    "boundary_safety": boundary,
                    "tempo_reliability": 0.91,
                    "vocal_collision": vocal,
                },
            }],
        }
        return build_mixplan(plan)

    def test_safe_case_passes_with_high_score(self) -> None:
        result = evaluate_mixplan(self._manifest())
        self.assertTrue(result["pass"])
        self.assertGreater(result["score"], 0.75)
        self.assertEqual(result["unsafe_long_blend_count"], 0)

    def test_low_confidence_is_visible_without_becoming_fake_hard_failure(self) -> None:
        result = evaluate_mixplan(self._manifest(confidence=0.42, bars=4, boundary=0.44))
        self.assertTrue(result["pass"])
        self.assertEqual(result["low_confidence_transition_count"], 1)
        self.assertEqual(result["risky_transition_count"], 1)

    def test_long_blend_with_weak_boundary_is_a_hard_eval_failure(self) -> None:
        result = evaluate_mixplan(self._manifest(confidence=0.72, bars=32, boundary=0.31))
        self.assertFalse(result["pass"])
        self.assertEqual(result["unsafe_long_blend_count"], 1)

    def test_long_blend_with_vocal_collision_is_a_hard_eval_failure(self) -> None:
        result = evaluate_mixplan(self._manifest(confidence=0.78, bars=16, boundary=0.82, vocal=0.6))
        self.assertFalse(result["pass"])
        self.assertEqual(result["unsafe_long_blend_count"], 1)


if __name__ == "__main__":
    unittest.main()
