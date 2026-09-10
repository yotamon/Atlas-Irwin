from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.automix_manifest import AUTOMATION_VERSION, build_mixplan, validate_mixplan
from app.automix_model import SAMPLE_RATE
from app.automix_transition_dsp_v2 import mix_transition_v2


class TransitionDSPV2Test(unittest.TestCase):
    def _audio(self) -> tuple[np.ndarray, np.ndarray]:
        t = np.arange(SAMPLE_RATE * 4, dtype=np.float32) / SAMPLE_RATE
        a = 0.24 * np.sin(2 * np.pi * 90 * t) + 0.07 * np.sin(2 * np.pi * 1900 * t)
        b = 0.23 * np.sin(2 * np.pi * 112 * t) + 0.06 * np.sin(2 * np.pi * 2500 * t)
        return (
            np.stack([a, a * 0.98], axis=1).astype(np.float32),
            np.stack([b, b * 0.97], axis=1).astype(np.float32),
        )

    def _manifest(self, technique: str = "bass_swap") -> dict:
        return build_mixplan({
            "version": "ensemblis.automix.v1",
            "purpose": "booking",
            "energy_profile": "dynamic",
            "transition_style": "dj",
            "requested_duration_ms": 180_000,
            "estimated_duration_ms": 172_000,
            "tracks": [
                {"track_id": "a", "title": "A", "source_start_ms": 0, "source_end_ms": 90_000, "playback_bpm": 122.0, "time_factor": 1.0},
                {"track_id": "b", "title": "B", "source_start_ms": 0, "source_end_ms": 90_000, "playback_bpm": 122.0, "time_factor": 1.0},
            ],
            "transitions": [{
                "from_track_id": "a",
                "to_track_id": "b",
                "technique": technique,
                "bars": 8 if technique != "echo_out" else 0,
                "beatmatch": technique != "echo_out",
                "overlap_ms": 2_000,
                "confidence": 0.86,
                "fallback": {"technique": "quick_mix", "bars": 4},
            }],
        })

    def test_manifest_contains_versioned_executable_automation(self) -> None:
        transition = self._manifest()["transitions"][0]
        automation = transition["automation"]
        self.assertEqual(automation["version"], AUTOMATION_VERSION)
        self.assertEqual(automation["duration_ms"], 2_000)
        self.assertIsNotNone(automation["low_end_handoff"])
        self.assertEqual(len(automation["from_gain"]), 3)

    def test_bass_swap_executes_declared_envelopes_and_is_peak_safe(self) -> None:
        a, b = self._audio()
        transition = self._manifest("bass_swap")["transitions"][0]
        rendered = mix_transition_v2(a, b, transition, 122.0)
        self.assertEqual(len(rendered), SAMPLE_RATE * 2)
        self.assertTrue(np.all(np.isfinite(rendered)))
        self.assertLessEqual(float(np.max(np.abs(rendered))), 0.986)

    def test_echo_out_uses_bounded_feedback(self) -> None:
        a, b = self._audio()
        transition = self._manifest("echo_out")["transitions"][0]
        self.assertEqual(transition["automation"]["fx"]["kind"], "echo_out")
        rendered = mix_transition_v2(a, b, transition, 122.0)
        self.assertEqual(len(rendered), SAMPLE_RATE * 2)
        self.assertTrue(np.all(np.isfinite(rendered)))
        self.assertLessEqual(float(np.max(np.abs(rendered))), 0.986)

    def test_invalid_echo_feedback_is_rejected_by_mixplan_validator(self) -> None:
        manifest = self._manifest("echo_out")
        manifest["transitions"][0]["automation"]["fx"]["feedback"] = 0.95
        with self.assertRaisesRegex(ValueError, "feedback"):
            validate_mixplan(manifest)

    def test_invalid_low_end_cutoff_is_rejected(self) -> None:
        manifest = self._manifest("bass_swap")
        manifest["transitions"][0]["automation"]["low_end_handoff"]["cutoff_hz"] = 900.0
        with self.assertRaisesRegex(ValueError, "cutoff"):
            validate_mixplan(manifest)


if __name__ == "__main__":
    unittest.main()
