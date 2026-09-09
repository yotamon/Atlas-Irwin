from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.automix_transition_regions import choose_transition_region


class TransitionRegionTest(unittest.TestCase):
    def _map(self) -> dict:
        return {
            "duration_ms": 120_000,
            "sections": [
                {"start_ms": 0, "end_ms": 30_000, "label": "intro", "confidence": 0.92},
                {"start_ms": 30_000, "end_ms": 72_000, "label": "chorus", "confidence": 0.95},
                {"start_ms": 72_000, "end_ms": 96_000, "label": "break", "confidence": 0.94},
                {"start_ms": 96_000, "end_ms": 120_000, "label": "outro", "confidence": 0.96},
            ],
            "phrases": [
                {"start_ms": 72_000, "end_ms": 80_000, "confidence": 0.94},
                {"start_ms": 88_000, "end_ms": 96_000, "confidence": 0.93},
            ],
            "downbeat_source": "model",
            "downbeats_ms": [72_000, 80_000, 88_000, 96_000, 104_000],
            "moments": {
                "climax": [{"start_ms": 83_000, "end_ms": 91_000, "score": 0.97}],
            },
            "automix_vocals_activity_curve": [
                {"start_ms": ms, "end_ms": ms + 1000, "active_ratio": 0.05 if ms >= 92_000 else 0.85, "energy": 0.08 if ms >= 92_000 else 0.8, "active": ms < 92_000}
                for ms in range(60_000, 121_000, 1000)
            ],
            "automix_bass_activity_curve": [
                {"start_ms": ms, "end_ms": ms + 1000, "active_ratio": 0.12 if ms >= 92_000 else 0.7, "energy": 0.12 if ms >= 92_000 else 0.7, "active": ms < 92_000}
                for ms in range(60_000, 121_000, 1000)
            ],
        }

    def test_exit_prefers_supported_sparse_boundary_over_protected_peak(self) -> None:
        region = choose_transition_region(self._map(), 108_000, "exit", radius_ms=24_000)
        self.assertGreaterEqual(region["ms"], 92_000)
        self.assertNotEqual(region["ms"], 88_000)
        self.assertLess(region["protected_moment_penalty"], 0.2)
        self.assertGreater(region["score"], 0.45)

    def test_entry_only_moves_forward_from_original_window_edge(self) -> None:
        region = choose_transition_region(self._map(), 72_000, "entry", radius_ms=24_000)
        self.assertGreaterEqual(region["ms"], 72_000)
        self.assertLessEqual(region["ms"], 96_000)

    def test_exit_only_moves_backward_from_original_window_edge(self) -> None:
        region = choose_transition_region(self._map(), 96_000, "exit", radius_ms=24_000)
        self.assertLessEqual(region["ms"], 96_000)
        self.assertGreaterEqual(region["ms"], 72_000)


if __name__ == "__main__":
    unittest.main()
