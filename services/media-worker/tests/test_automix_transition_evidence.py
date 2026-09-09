from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.automix_intelligence import transition_boundary_evidence
from app.automix_model import MusicalKey, TrackDescriptor, normalize_dj_bpm
from app.automix_planner import build_plan, choose_transition, transition_score


class AutoMixTransitionEvidenceTest(unittest.TestCase):
    def _track(
        self,
        track_id: str,
        *,
        bpm: float = 122.0,
        camelot: str = "8A",
        energy: float = 0.62,
        start_ms: int = 0,
        end_ms: int = 90_000,
        sections: list[dict] | None = None,
    ) -> TrackDescriptor:
        number = int(camelot[:-1])
        key = MusicalKey(
            root_pc=(number - 1) % 12,
            mode="minor" if camelot[-1] == "A" else "major",
            confidence=0.92,
            camelot=camelot,
            label=f"Key {camelot}",
        )
        timeline = [
            {"ms": ms, "bpm": bpm, "deviation_bpm": 0.0}
            for ms in range(0, 180_001, 5_000)
        ]
        music_map = {
            "duration_ms": 180_000,
            "beat_stability": {
                "classification": "stable",
                "confidence": 0.95,
                "local_jitter_bpm": 0.12,
                "timeline": timeline,
            },
            "master_qc": {
                "technical_ready": True,
                "integrated_lufs": -10.0,
                "true_peak_dbtp": -1.0,
                "clipping_ratio": 0.0,
            },
            "sections": sections if sections is not None else [
                {"start_ms": 0, "end_ms": 90_000, "label": "instrumental", "confidence": 0.94},
                {"start_ms": 90_000, "end_ms": 180_000, "label": "outro", "confidence": 0.94},
            ],
            "phrases": [],
            "downbeats_ms": [],
        }
        return TrackDescriptor(
            id=track_id,
            title=track_id,
            url=f"https://example.com/{track_id}.wav",
            path=Path(f"/{track_id}.wav"),
            music_map=music_map,
            duration_ms=180_000,
            bpm=bpm,
            dj_bpm=normalize_dj_bpm(bpm),
            key=key,
            energy=energy,
            loudness_lufs=-10.0,
            window_start_ms=start_ms,
            window_end_ms=end_ms,
            window_score=0.9,
        )

    def test_boundary_evidence_distinguishes_structure_from_suitability(self) -> None:
        track = self._track("structured")
        evidence = transition_boundary_evidence(track.music_map, 90_000, "exit")
        self.assertEqual(evidence["boundary_ms"], 90_000)
        self.assertIn(evidence["kind"], {"section_start", "section_end"})
        self.assertGreater(float(evidence["boundary_confidence"]), 0.85)
        self.assertGreater(float(evidence["suitability"]), 0.7)
        self.assertGreater(float(evidence["confidence"]), 0.8)

    def test_weak_boundary_evidence_vetoes_long_blend_even_when_tempo_and_key_match(self) -> None:
        # Deliberately choose arbitrary mid-section windows and remove all structural
        # boundaries. BPM/key compatibility alone must not authorize a 16/32-bar blend.
        a = self._track("weak-a", start_ms=17_000, end_ms=73_000, sections=[])
        b = self._track("weak-b", start_ms=21_000, end_ms=77_000, sections=[])
        metrics = transition_score(a, b, 0.5, "booking", "dynamic")
        technique, bars, beatmatch, reasons = choose_transition(a, b, metrics, "dj")

        self.assertLess(metrics["boundary_safety"], 0.38)
        self.assertTrue(beatmatch)
        self.assertEqual(technique, "quick_mix")
        self.assertEqual(bars, 4)
        self.assertTrue(any("boundary" in reason for reason in reasons))

        plan = build_plan([a, b], "journey", "dynamic", "dj", 8 * 60 * 1000)
        transition = plan["transitions"][0]
        self.assertIn("weak_boundary_evidence", transition["risk_flags"])
        self.assertNotIn(transition["technique"], {"harmonic_blend", "bass_swap", "breakdown_swap"})

    def test_plan_exposes_transition_confidence_evidence_fallback_and_quality_summary(self) -> None:
        a = self._track("a", energy=0.55)
        b = self._track("b", energy=0.68)
        plan = build_plan([a, b], "journey", "dynamic", "dj", 8 * 60 * 1000)
        transition = plan["transitions"][0]

        self.assertIsInstance(transition["confidence"], float)
        self.assertGreaterEqual(transition["confidence"], 0.0)
        self.assertLessEqual(transition["confidence"], 1.0)
        self.assertIn("risk_flags", transition)
        self.assertIn("fallback", transition)
        self.assertIn(transition["fallback"]["technique"], {"quick_mix", "drop_cut", "echo_out"})
        self.assertIn("evidence", transition)
        self.assertIn("from_boundary", transition["evidence"])
        self.assertIn("to_boundary", transition["evidence"])
        self.assertIn("activity", transition["evidence"])

        summary = plan["quality_summary"]
        self.assertEqual(summary["transition_count"], 1)
        self.assertAlmostEqual(summary["mean_confidence"], transition["confidence"], places=4)
        self.assertAlmostEqual(summary["minimum_confidence"], transition["confidence"], places=4)
        self.assertTrue(plan["quality_contract"]["boundary_confidence_aware"])
        self.assertTrue(plan["quality_contract"]["structured_transition_risk"])
        self.assertTrue(plan["quality_contract"]["safe_transition_fallbacks"])


if __name__ == "__main__":
    unittest.main()
