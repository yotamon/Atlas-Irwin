from __future__ import annotations

import unittest

from app.moment_rhythm import beat_sync_strongest_moments


def _moment(
    index: int,
    start_ms: int,
    end_ms: int,
    peak_start_ms: int,
    peak_end_ms: int,
    score: float = 0.9,
) -> dict:
    return {
        "id": f"strongest-hook-{index}",
        "rank": index,
        "label": "Signature Chorus",
        "kind": "musical_identity",
        "start_ms": start_ms,
        "end_ms": end_ms,
        "duration_ms": end_ms - start_ms,
        "section_id": f"section-{index}",
        "section_type": "chorus",
        "section_label": "Chorus",
        "score": score,
        "reasons": ["Playback expands the scoring peak to complete musical context."],
        "peak_window": {
            "candidate_id": f"hook-{index}",
            "start_ms": peak_start_ms,
            "end_ms": peak_end_ms,
            "duration_ms": peak_end_ms - peak_start_ms,
            "score": score,
        },
        "context": {
            "strategy": "analysis_peak_with_musical_context",
            "target_duration_ms": 20_000,
        },
    }


def _base_result(duration_ms: int = 120_000) -> dict:
    beats = list(range(0, duration_ms + 1, 500))
    return {
        "duration_ms": duration_ms,
        "bpm": 120.0,
        "beat_confidence": 0.96,
        "beats_ms": beats,
        "downbeats_ms": list(range(0, duration_ms + 1, 2_000)),
        "downbeat_source": "model",
        "bars": [
            {
                "index": index + 1,
                "start_ms": start,
                "end_ms": min(duration_ms, start + 2_000),
                "section_id": None,
                "confidence": 0.95,
                "provenance": "model",
            }
            for index, start in enumerate(range(0, duration_ms, 2_000))
        ],
        "phrases": [],
        "sections": [],
        "analysis": {"strongest_moments": {}},
    }


class MomentRhythmSyncTest(unittest.TestCase):
    def test_misaligned_context_edges_are_hard_locked_to_canonical_beats(self) -> None:
        result = _base_result()
        result["sections"] = [
            {
                "id": "chorus",
                "start_ms": 57_130,
                "end_ms": 72_120,
                "type": "chorus",
                "label": "Chorus",
                "confidence": 0.97,
            },
        ]
        result["strongest_moments"] = [
            _moment(1, 57_130, 72_120, 57_240, 64_060),
        ]

        beat_sync_strongest_moments(result)

        self.assertEqual(len(result["strongest_moments"]), 1)
        moment = result["strongest_moments"][0]
        self.assertIn(moment["start_ms"], result["beats_ms"])
        self.assertIn(moment["end_ms"], result["beats_ms"])
        self.assertLessEqual(moment["start_ms"], moment["peak_window"]["start_ms"])
        self.assertGreaterEqual(moment["end_ms"], moment["peak_window"]["end_ms"])
        self.assertTrue(moment["context"]["rhythm_sync"]["beat_locked"])
        self.assertEqual(moment["context"]["rhythm_sync"]["grid_source"], "canonical_beats")

    def test_downbeat_is_preferred_when_it_preserves_the_peak_and_context(self) -> None:
        result = _base_result()
        result["sections"] = [
            {
                "id": "chorus",
                "start_ms": 58_060,
                "end_ms": 78_040,
                "type": "chorus",
                "label": "Chorus",
                "confidence": 0.98,
            },
        ]
        result["strongest_moments"] = [
            _moment(1, 58_060, 78_040, 58_120, 66_000),
        ]

        beat_sync_strongest_moments(result)

        moment = result["strongest_moments"][0]
        self.assertEqual(moment["start_ms"], 58_000)
        self.assertEqual(moment["context"]["rhythm_sync"]["start_anchor"], "downbeat")
        self.assertIn(moment["end_ms"], result["beats_ms"])

    def test_sync_keeps_selected_moments_non_overlapping_even_after_boundary_moves(self) -> None:
        result = _base_result(90_000)
        result["strongest_moments"] = [
            _moment(1, 10_120, 30_080, 12_000, 20_000, 0.98),
            _moment(2, 30_140, 50_060, 33_000, 41_000, 0.94),
            _moment(3, 60_120, 80_060, 63_000, 71_000, 0.90),
        ]

        beat_sync_strongest_moments(result)

        moments = result["strongest_moments"]
        self.assertGreaterEqual(len(moments), 2)
        for moment in moments:
            self.assertTrue(moment["context"]["rhythm_sync"]["beat_locked"])
            self.assertIn(moment["start_ms"], result["beats_ms"])
            self.assertIn(moment["end_ms"], result["beats_ms"])
        for index, left in enumerate(moments):
            for right in moments[index + 1 :]:
                overlap = max(
                    0,
                    min(left["end_ms"], right["end_ms"])
                    - max(left["start_ms"], right["start_ms"]),
                )
                self.assertEqual(overlap, 0)

    def test_missing_rhythm_grid_is_explicit_instead_of_faking_sync(self) -> None:
        result = {
            "duration_ms": 60_000,
            "beats_ms": [],
            "downbeats_ms": [],
            "bars": [],
            "sections": [],
            "phrases": [],
            "analysis": {"strongest_moments": {}},
            "strongest_moments": [_moment(1, 10_000, 30_000, 14_000, 22_000)],
        }

        beat_sync_strongest_moments(result)

        self.assertEqual(len(result["strongest_moments"]), 1)
        sync = result["strongest_moments"][0]["context"]["rhythm_sync"]
        self.assertFalse(sync["beat_locked"])
        self.assertEqual(sync["grid_source"], "none")
        self.assertEqual(result["analysis"]["strongest_moments"]["rhythm_sync"]["beat_locked_count"], 0)


if __name__ == "__main__":
    unittest.main()
