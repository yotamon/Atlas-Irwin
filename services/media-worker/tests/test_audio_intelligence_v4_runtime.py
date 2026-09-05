from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from app.audio_intelligence_providers import (
    provider_capabilities,
    run_basic_pitch_stem,
    run_beat_this_shadow,
)
from app.music_intelligence_v4_runtime import _compatibility_enrich
from app.stem_intelligence_v3 import _arrangement_events, _section_arrangement


class AudioIntelligenceV4RuntimeTest(unittest.TestCase):
    def test_runtime_provider_registry_is_truthful_and_commercially_safe(self) -> None:
        with patch.dict(os.environ, {
            "ATLAS_BEAT_THIS_ENABLED": "false",
            "ATLAS_BASIC_PITCH_ENABLED": "false",
        }, clear=False):
            capabilities = provider_capabilities()

        self.assertEqual(capabilities["beat_this"]["mode"], "shadow")
        self.assertEqual(capabilities["beat_this"]["license_policy"], "commercial_ok_mit")
        self.assertEqual(capabilities["mert"]["mode"], "research_only")
        self.assertEqual(capabilities["mert"]["license_policy"], "blocked_for_commercial_default_weights")
        self.assertEqual(capabilities["singing_forced_alignment"]["mode"], "external_adapter")
        self.assertFalse(capabilities["mert"]["enabled"])

    def test_optional_providers_fail_soft_when_disabled(self) -> None:
        fake_path = Path("/tmp/does-not-need-to-exist.wav")
        with patch.dict(os.environ, {
            "ATLAS_BEAT_THIS_ENABLED": "false",
            "ATLAS_BASIC_PITCH_ENABLED": "false",
        }, clear=False):
            beat_this = run_beat_this_shadow(fake_path)
            basic_pitch = run_basic_pitch_stem(fake_path, "vocals")

        self.assertEqual(beat_this["status"], "disabled")
        self.assertEqual(basic_pitch["status"], "disabled")

    def test_percussive_stems_never_attempt_note_transcription(self) -> None:
        result = run_basic_pitch_stem(Path("/tmp/unused.wav"), "drums")
        self.assertEqual(result["status"], "not_applicable")
        self.assertEqual(result["category"], "drums")

    def test_runtime_restores_existing_consumer_compatibility_fields(self) -> None:
        result = {
            "sections": [
                {"id": "chorus", "type": "chorus", "start_ms": 8000, "end_ms": 24000},
            ],
            "hook_candidates": [
                {
                    "id": "moment-v4-1",
                    "section_id": "chorus",
                    "start_ms": 8000,
                    "end_ms": 24000,
                    "metrics": {
                        "energy": 0.88,
                        "energy_lift": 0.71,
                        "semantic_recurrence": 0.92,
                        "harmonic_distinctiveness": 0.79,
                        "onset_density": 0.66,
                    },
                },
            ],
        }

        _compatibility_enrich(result)
        candidate = result["hook_candidates"][0]

        self.assertEqual(candidate["target_duration_ms"], 16000)
        self.assertEqual(candidate["section_type"], "chorus")
        self.assertEqual(candidate["energy"], 0.88)
        self.assertEqual(candidate["repetition"], 0.92)
        self.assertEqual(candidate["melodic_salience"], 0.79)
        self.assertEqual(candidate["rhythmic_activity"], 0.66)

    def test_stem_arrangement_evidence_detects_entry_lift_and_exit(self) -> None:
        events = _arrangement_events([
            {"start_ms": 0, "active": False, "energy": 0.03, "rhythmic_activity": 0.02},
            {"start_ms": 500, "active": True, "energy": 0.30, "rhythmic_activity": 0.40},
            {"start_ms": 1000, "active": True, "energy": 0.64, "rhythmic_activity": 0.55},
            {"start_ms": 1500, "active": False, "energy": 0.05, "rhythmic_activity": 0.03},
        ])
        kinds = [event["kind"] for event in events]

        self.assertEqual(kinds, ["entry", "lift", "exit"])
        self.assertEqual(events[0]["at_ms"], 500)
        self.assertEqual(events[-1]["at_ms"], 1500)

    def test_stem_section_transitions_explain_lifts_and_releases(self) -> None:
        transitions = _section_arrangement([
            {"section_id": "verse", "start_ms": 0, "energy": 0.30, "active_ratio": 0.42},
            {"section_id": "chorus", "start_ms": 16000, "energy": 0.68, "active_ratio": 0.82},
            {"section_id": "break", "start_ms": 32000, "energy": 0.25, "active_ratio": 0.31},
        ])

        self.assertEqual([item["kind"] for item in transitions], ["section_lift", "section_release"])
        self.assertEqual(transitions[0]["section_id"], "chorus")
        self.assertEqual(transitions[1]["section_id"], "break")


if __name__ == "__main__":
    unittest.main()
