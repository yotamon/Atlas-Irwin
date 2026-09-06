from __future__ import annotations

import unittest

from benchmarks.robustness_metrics import compare_analyses


class AudioRobustnessMetricsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.baseline = {
            "duration_ms": 60000,
            "bpm": 120.0,
            "sections": [
                {"start_ms": 0, "end_ms": 16000},
                {"start_ms": 16000, "end_ms": 32000},
                {"start_ms": 32000, "end_ms": 60000},
            ],
            "musical_moments": [
                {"start_ms": 16000, "end_ms": 24000, "semantic_descriptors": [{"text": "groove"}, {"text": "hook"}]},
                {"start_ms": 32000, "end_ms": 40000, "semantic_descriptors": [{"text": "climax"}]},
            ],
        }

    def test_identity_preserving_variant_passes(self) -> None:
        candidate = {
            **self.baseline,
            "bpm": 120.15,
            "sections": [
                {"start_ms": 0, "end_ms": 16100},
                {"start_ms": 16100, "end_ms": 32150},
                {"start_ms": 32150, "end_ms": 60000},
            ],
            "musical_moments": [
                {"start_ms": 16100, "end_ms": 24100, "semantic_descriptors": [{"text": "groove"}, {"text": "hook"}]},
                {"start_ms": 32100, "end_ms": 40100, "semantic_descriptors": [{"text": "climax"}]},
            ],
        }
        report = compare_analyses(self.baseline, candidate)
        self.assertTrue(report["passed"])
        self.assertLess(report["metrics"]["section_boundary_median_drift_ms"], 650)
        self.assertEqual(report["metrics"]["moment_top3_temporal_recall"], 1.0)

    def test_structurally_different_variant_fails(self) -> None:
        candidate = {
            "duration_ms": 60000,
            "bpm": 126.0,
            "sections": [
                {"start_ms": 0, "end_ms": 24000},
                {"start_ms": 24000, "end_ms": 60000},
            ],
            "musical_moments": [
                {"start_ms": 45000, "end_ms": 53000, "semantic_descriptors": [{"text": "ambient"}]},
            ],
        }
        report = compare_analyses(self.baseline, candidate)
        self.assertFalse(report["passed"])
        self.assertFalse(report["checks"]["bpm"])
        self.assertFalse(report["checks"]["moments"])
        self.assertFalse(report["checks"]["semantic_descriptors"])


if __name__ == "__main__":
    unittest.main()
