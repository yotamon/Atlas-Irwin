from __future__ import annotations

import unittest

from app.music_intelligence_v4 import MAX_PRIMARY_MOMENTS, upgrade_music_intelligence


def _candidate(index: int, start: int, end: int, section: str, score: float) -> dict:
    intent = {
        "instant_hook": min(1.0, score + 0.05),
        "musical_identity": score,
        "groove_loop": max(0.0, score - 0.05),
        "build_drop": max(0.0, score - 0.1),
        "climax": score,
        "story_arc": max(0.0, score - 0.04),
    }
    return {
        "id": f"hook-{index}",
        "start_ms": start,
        "end_ms": end,
        "duration_ms": end - start,
        "score": score,
        "kind": "instant_hook",
        "section_label": section,
        "intent_scores": intent,
        "metrics": {
            "energy": score,
            "energy_lift": score,
            "onset_density": score,
            "groove_stability": 0.78,
            "semantic_recurrence": score,
            "harmonic_recurrence": 0.7,
            "harmonic_distinctiveness": 0.65,
            "novelty": 0.6,
            "structure": 0.9,
            "segment_confidence": 0.9,
            "boundary_fit": 0.95,
            "boundary_loop_fit": 0.8,
            "arc_strength": 0.7,
        },
    }


def _v3_fixture() -> dict:
    bars = []
    for index, start in enumerate(range(0, 48000, 2000), 1):
        bars.append({
            "index": index,
            "start_ms": start,
            "end_ms": start + 2000,
            "section_id": "section-a" if start < 24000 else "section-b",
            "confidence": 0.95,
            "provenance": "model",
        })
    phrases = []
    for index, start in enumerate(range(0, 48000, 8000), 1):
        phrases.append({
            "id": f"phrase-{index}",
            "start_ms": start,
            "end_ms": start + 8000,
            "section_id": "section-a" if start < 24000 else "section-b",
            "bar_start": (start // 2000) + 1,
            "bar_end": (start // 2000) + 4,
            "confidence": 0.93,
            "provenance": "semantic_section_4bar",
        })
    candidates = [
        _candidate(1, 0, 6000, "Verse", 0.72),
        _candidate(2, 8000, 16000, "Verse", 0.82),
        _candidate(3, 16000, 31000, "Verse → Chorus", 0.86),
        _candidate(4, 24000, 32000, "Chorus", 0.96),
        _candidate(5, 32000, 40000, "Chorus", 0.91),
        _candidate(6, 40000, 48000, "Chorus", 0.88),
    ]
    return {
        "version": 3,
        "duration_ms": 48000,
        "bpm": 120.0,
        "beat_confidence": 0.94,
        "beats_ms": list(range(0, 48000, 500)),
        "downbeats_ms": list(range(0, 48000, 2000)),
        "downbeat_source": "model",
        "bars": bars,
        "phrases": phrases,
        "sections": [
            {"id": "section-a", "start_ms": 0, "end_ms": 24000, "type": "verse", "label": "Verse", "confidence": 0.91},
            {"id": "section-b", "start_ms": 24000, "end_ms": 48000, "type": "chorus", "label": "Chorus", "confidence": 0.97},
        ],
        "hook_candidates": candidates,
        "social_cuts": {},
        "social_cut_options": {},
        "master_qc": {
            "technical_ready": True,
            "integrated_lufs": -10.4,
            "true_peak_dbtp": -1.0,
            "crest_factor_db": 8.1,
            "stereo_correlation": 0.4,
        },
        "analysis": {
            "engine": "all-in-one",
            "config": "atlas-ti-v3.0.0",
            "confidence": {"rhythm": 0.94, "structure": 0.91, "hooks": 0.88, "overall": 0.91},
        },
        "source_audio": {"url": "https://example.test/master.wav", "analysis_config": "atlas-ti-v3.0.0"},
    }


class TrackIntelligenceV4Test(unittest.TestCase):
    def test_v4_selects_few_complete_diverse_moments(self) -> None:
        result = upgrade_music_intelligence(_v3_fixture())
        moments = result["musical_moments"]

        self.assertEqual(result["version"], 4)
        self.assertEqual(result["schema"], "atlas.track_music_intelligence.v4")
        self.assertGreaterEqual(len(moments), 1)
        self.assertLessEqual(len(moments), MAX_PRIMARY_MOMENTS)
        self.assertTrue(all(moment["unit_kind"] in {"phrase", "phrase_pair", "section"} for moment in moments))
        self.assertTrue(all(moment["musical_completeness"] >= 0.75 for moment in moments))
        self.assertEqual(len({(moment["start_ms"], moment["end_ms"]) for moment in moments}), len(moments))
        self.assertEqual(result["analysis"]["moment_selection"]["strategy"], "musical_units_then_derived_cuts")

    def test_social_cuts_are_derived_from_parent_moments_on_boundaries(self) -> None:
        result = upgrade_music_intelligence(_v3_fixture())
        valid_boundaries = set(result["downbeats_ms"])

        for duration in ("6", "8", "15", "30"):
            for cut in result["social_cut_options"][duration]:
                if cut.get("legacy_fallback"):
                    continue
                self.assertTrue(cut["source_moment_id"])
                self.assertIs(cut["musical_boundary_constrained"], True)
                self.assertIn(cut["start_ms"], valid_boundaries)
                self.assertTrue(cut["end_ms"] in valid_boundaries or cut["end_ms"] == result["duration_ms"])

    def test_visible_hook_candidates_are_the_same_complete_moments(self) -> None:
        result = upgrade_music_intelligence(_v3_fixture())
        self.assertEqual(result["hook_candidates"], result["musical_moments"])
        self.assertGreater(len(result["hook_candidates_v3"]), len(result["hook_candidates"]))

    def test_rhythm_consensus_crosschecks_model_downbeats_against_beat_grid(self) -> None:
        result = upgrade_music_intelligence(_v3_fixture())
        consensus = result["rhythm_consensus"]
        self.assertIs(consensus["internal_grid_crosscheck"]["available"], True)
        self.assertEqual(consensus["internal_grid_crosscheck"]["median_downbeat_distance_ms"], 0.0)
        self.assertEqual(consensus["internal_grid_crosscheck"]["agreement"], 1.0)
        self.assertGreater(consensus["confidence"], 0.9)

    def test_timeline_preserves_provenance_and_exposes_external_fusion_contract(self) -> None:
        result = upgrade_music_intelligence(_v3_fixture())
        timeline = result["timeline"]
        self.assertEqual(timeline["version"], "atlas.musical_timeline.v1")
        self.assertTrue(any(event["kind"] == "section" for event in timeline["events"]))
        self.assertTrue(any(event["kind"] == "phrase" for event in timeline["events"]))
        self.assertTrue(any(event["kind"] == "musical_moment" and event["analyzer"] == "track_intelligence_v4" for event in timeline["events"]))
        self.assertIn("lyrics_intelligence", timeline["fusion_contract"]["external_evidence"])
        self.assertIn("stem_intelligence", timeline["fusion_contract"]["external_evidence"])

    def test_core_provider_features_are_gated_before_runtime_enrichment(self) -> None:
        result = upgrade_music_intelligence(_v3_fixture())
        capabilities = result["provider_capabilities"]
        self.assertEqual(capabilities["beat_this"]["tier"], "deep")
        self.assertEqual(capabilities["mert"]["tier"], "on_demand")
        self.assertEqual(capabilities["basic_pitch"]["tier"], "on_demand")
        self.assertEqual(capabilities["singing_aligner"]["status"], "adapter_required")


if __name__ == "__main__":
    unittest.main()
