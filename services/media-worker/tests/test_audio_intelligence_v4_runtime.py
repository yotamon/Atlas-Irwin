from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from app.audio_intelligence_providers import (
    provider_capabilities,
    run_basic_pitch_stem,
    run_beat_this_shadow,
    run_clap_audio_semantics,
    summarize_melody,
)
from app.music_intelligence_v4_runtime import _attach_cross_modal_semantics, _compatibility_enrich
from app.stem_intelligence_v3 import _arrangement_events, _section_arrangement


class AudioIntelligenceV4RuntimeTest(unittest.TestCase):
    def test_runtime_provider_registry_is_truthful_and_commercially_safe(self) -> None:
        with patch.dict(os.environ, {
            "ENSEMBLIS_BEAT_THIS_ENABLED": "false",
            "ENSEMBLIS_BASIC_PITCH_ENABLED": "false",
            "ENSEMBLIS_CLAP_ENABLED": "false",
            "ENSEMBLIS_CLAP_ALLOW_DOWNLOAD": "false",
        }, clear=False):
            capabilities = provider_capabilities()

        self.assertEqual(capabilities["beat_this"]["mode"], "shadow")
        self.assertEqual(capabilities["beat_this"]["license_policy"], "commercial_ok_mit")
        self.assertEqual(capabilities["clap"]["mode"], "moment_semantics")
        self.assertEqual(capabilities["clap"]["license_policy"], "commercial_ok_apache_2_model_card_reviewed")
        self.assertFalse(capabilities["clap"]["allow_download"])
        self.assertEqual(capabilities["mert"]["mode"], "research_only")
        self.assertEqual(capabilities["mert"]["license_policy"], "blocked_for_commercial_default_weights")
        self.assertEqual(capabilities["singing_forced_alignment"]["mode"], "external_adapter")
        self.assertFalse(capabilities["mert"]["enabled"])

    def test_new_env_names_take_priority_over_legacy_aliases(self) -> None:
        with patch.dict(os.environ, {
            "ENSEMBLIS_BEAT_THIS_ENABLED": "false",
            "ATLAS_BEAT_THIS_ENABLED": "true",
            "ENSEMBLIS_CLAP_MODEL": "preferred/model",
            "ATLAS_CLAP_MODEL": "legacy/model",
        }, clear=False):
            capabilities = provider_capabilities()

        self.assertFalse(capabilities["beat_this"]["enabled"])
        self.assertEqual(capabilities["clap"]["model"], "preferred/model")

    def test_optional_providers_fail_soft_when_disabled(self) -> None:
        fake_path = Path("/tmp/does-not-need-to-exist.wav")
        with patch.dict(os.environ, {
            "ENSEMBLIS_BEAT_THIS_ENABLED": "false",
            "ENSEMBLIS_BASIC_PITCH_ENABLED": "false",
            "ENSEMBLIS_CLAP_ENABLED": "false",
        }, clear=False):
            beat_this = run_beat_this_shadow(fake_path)
            basic_pitch = run_basic_pitch_stem(fake_path, "vocals")
            clap = run_clap_audio_semantics(fake_path, [{"id": "m1", "start_ms": 0, "end_ms": 8000}])

        self.assertEqual(beat_this["status"], "disabled")
        self.assertEqual(basic_pitch["status"], "disabled")
        self.assertEqual(clap["status"], "disabled")

    def test_percussive_stems_never_attempt_note_transcription(self) -> None:
        result = run_basic_pitch_stem(Path("/tmp/unused.wav"), "drums")
        self.assertEqual(result["status"], "not_applicable")
        self.assertEqual(result["category"], "drums")

    def test_melodic_summary_extracts_contour_climax_and_repeated_motif(self) -> None:
        notes = []
        pitches = [60, 62, 64, 67, 62, 64, 66, 69, 64, 66, 68, 71]
        for index, midi in enumerate(pitches):
            notes.append({
                "start_ms": index * 500,
                "end_ms": index * 500 + (900 if index % 4 == 3 else 320),
                "midi": midi,
                "velocity": 0.72 + (0.02 if index % 4 == 3 else 0.0),
            })

        summary = summarize_melody(notes)

        self.assertTrue(summary["available"])
        self.assertEqual(summary["note_count"], len(notes))
        self.assertEqual(summary["pitch"]["min_midi"], 60)
        self.assertEqual(summary["pitch"]["max_midi"], 71)
        self.assertEqual(summary["contour"]["direction"], "rising")
        self.assertEqual(summary["climax"]["midi"], 71)
        self.assertGreater(summary["rhythm"]["note_density_per_second"], 1.0)
        self.assertGreaterEqual(len(summary["repeated_interval_motifs"]), 1)

    def test_melodic_summary_collapses_near_simultaneous_chord_notes(self) -> None:
        summary = summarize_melody([
            {"start_ms": 0, "end_ms": 600, "midi": 60, "velocity": 0.5},
            {"start_ms": 20, "end_ms": 600, "midi": 64, "velocity": 0.9},
            {"start_ms": 500, "end_ms": 1000, "midi": 67, "velocity": 0.8},
        ])
        self.assertEqual(summary["note_count"], 3)
        self.assertEqual(summary["representative_note_count"], 2)

    def test_semantic_evidence_is_attached_to_matching_moments_without_copying_vectors(self) -> None:
        result = {
            "analysis": {},
            "musical_moments": [{"id": "moment-v4-1", "start_ms": 1000, "end_ms": 9000}],
            "hook_candidates": [{"id": "moment-v4-1", "start_ms": 1000, "end_ms": 9000}],
        }
        semantic_result = {
            "status": "completed",
            "provider": "clap",
            "model": "test/model",
            "revision": "abc123",
            "embedding_dim": 3,
            "items": [{
                "id": "moment-v4-1",
                "embedding": [0.1, 0.2, 0.3],
                "descriptors": [{"text": "a driving groove", "similarity": 0.72}],
            }],
        }
        with patch("app.music_intelligence_v4_runtime.run_clap_audio_semantics", return_value=semantic_result):
            _attach_cross_modal_semantics(result, Path("/tmp/not-read.wav"))

        moment = result["musical_moments"][0]
        self.assertEqual(moment["semantic_descriptors"][0]["text"], "a driving groove")
        self.assertEqual(moment["semantic_embedding_ref"]["revision"], "abc123")
        self.assertNotIn("embedding", moment)
        self.assertEqual(result["analysis"]["semantic_intelligence"]["status"], "completed")
        self.assertIn("clap_moment_semantics", result["analysis_tiers"]["semantic"]["includes"])

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
