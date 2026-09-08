from __future__ import annotations

import unittest

from app.strongest_moments import (
    MAX_PER_SECTION_TYPE,
    MAX_VISIBLE_MOMENT_MS,
    MIN_VISIBLE_MOMENT_MS,
    TARGET_VISIBLE_MOMENT_MS,
    attach_strongest_moments,
    build_strongest_moments,
)


def _hook(
    index: int,
    start_ms: int,
    end_ms: int,
    score: float,
    section_label: str,
    section_type: str,
    kind: str = "musical_identity",
) -> dict:
    return {
        "id": f"hook-{index}",
        "label": f"{kind.replace('_', ' ').title()} · {section_label}",
        "kind": kind,
        "start_ms": start_ms,
        "end_ms": end_ms,
        "duration_ms": end_ms - start_ms,
        "target_duration_ms": end_ms - start_ms,
        "section_label": section_label,
        "section_type": section_type,
        "score": score,
        "intent_scores": {
            "instant_hook": max(0.0, score - 0.05),
            "musical_identity": score if kind == "musical_identity" else max(0.0, score - 0.08),
            "groove_loop": score if kind == "groove_loop" else max(0.0, score - 0.12),
            "build_drop": score if kind == "build_drop" else max(0.0, score - 0.14),
            "climax": score if kind == "climax" else max(0.0, score - 0.1),
            "story_arc": score if kind == "story_arc" else max(0.0, score - 0.16),
        },
        "reasons": ["High scoring analysis window."],
    }


def _bars(duration_ms: int, section_ranges: list[tuple[str, int, int]]) -> list[dict]:
    bars = []
    for index, start_ms in enumerate(range(0, duration_ms, 2000), 1):
        section = next(
            (section_id for section_id, start, end in section_ranges if start <= start_ms < end),
            None,
        )
        bars.append({
            "index": index,
            "start_ms": start_ms,
            "end_ms": min(duration_ms, start_ms + 2000),
            "section_id": section,
            "confidence": 0.95,
            "provenance": "model",
        })
    return bars


class StrongestMomentsTest(unittest.TestCase):
    def test_short_analysis_peak_expands_to_complete_chorus(self) -> None:
        duration_ms = 180_000
        result = {
            "duration_ms": duration_ms,
            "downbeat_source": "model",
            "downbeats_ms": list(range(0, duration_ms + 1, 2000)),
            "bars": _bars(duration_ms, [("verse", 0, 57_000), ("chorus", 57_000, 72_000)]),
            "phrases": [
                {"id": "chorus-a", "start_ms": 57_000, "end_ms": 64_500, "section_id": "chorus", "confidence": 0.94},
                {"id": "chorus-b", "start_ms": 64_500, "end_ms": 72_000, "section_id": "chorus", "confidence": 0.94},
            ],
            "sections": [
                {"id": "verse", "start_ms": 0, "end_ms": 57_000, "type": "verse", "label": "Verse", "confidence": 0.9},
                {"id": "chorus", "start_ms": 57_000, "end_ms": 72_000, "type": "chorus", "label": "Chorus", "confidence": 0.98},
                {"id": "after", "start_ms": 72_000, "end_ms": duration_ms, "type": "verse", "label": "Verse", "confidence": 0.9},
            ],
            "hook_candidates_v3": [_hook(1, 57_000, 64_000, 0.97, "Chorus", "chorus")],
        }

        strongest = build_strongest_moments(result)

        self.assertEqual(len(strongest), 1)
        self.assertEqual(strongest[0]["start_ms"], 57_000)
        self.assertEqual(strongest[0]["end_ms"], 72_000)
        self.assertEqual(strongest[0]["duration_ms"], 15_000)
        self.assertEqual(strongest[0]["peak_window"]["start_ms"], 57_000)
        self.assertEqual(strongest[0]["peak_window"]["end_ms"], 64_000)

    def test_visible_moments_keep_peak_inside_12_to_32_second_context(self) -> None:
        duration_ms = 180_000
        sections = [
            ("verse-a", 0, 24_000, "verse", "Verse"),
            ("chorus-a", 32_000, 52_000, "chorus", "Chorus"),
            ("bridge", 64_000, 84_000, "bridge", "Bridge"),
            ("chorus-b", 96_000, 116_000, "chorus", "Chorus"),
            ("outro", 132_000, 156_000, "outro", "Outro"),
        ]
        section_ranges = [(section_id, start, end) for section_id, start, end, _, _ in sections]
        result = {
            "duration_ms": duration_ms,
            "downbeat_source": "model",
            "downbeats_ms": list(range(0, duration_ms + 1, 2000)),
            "bars": _bars(duration_ms, section_ranges),
            "phrases": [],
            "sections": [
                {"id": section_id, "start_ms": start, "end_ms": end, "type": kind, "label": label, "confidence": 0.94}
                for section_id, start, end, kind, label in sections
            ],
            "hook_candidates_v3": [
                _hook(1, 5_000, 12_000, 0.84, "Verse", "verse", "groove_loop"),
                _hook(2, 34_000, 42_000, 0.98, "Chorus", "chorus"),
                _hook(3, 68_000, 75_000, 0.91, "Bridge", "bridge", "story_arc"),
                _hook(4, 100_000, 108_000, 0.94, "Chorus", "chorus", "climax"),
                _hook(5, 136_000, 143_000, 0.86, "Outro", "outro", "musical_identity"),
            ],
        }

        strongest = build_strongest_moments(result)

        self.assertGreaterEqual(len(strongest), 4)
        for moment in strongest:
            self.assertGreaterEqual(moment["duration_ms"], MIN_VISIBLE_MOMENT_MS)
            self.assertLessEqual(moment["duration_ms"], MAX_VISIBLE_MOMENT_MS)
            peak = moment["peak_window"]
            self.assertLessEqual(moment["start_ms"], peak["start_ms"])
            self.assertGreaterEqual(moment["end_ms"], peak["end_ms"])

        for index, left in enumerate(strongest):
            for right in strongest[index + 1 :]:
                overlap = max(0, min(left["end_ms"], right["end_ms"]) - max(left["start_ms"], right["start_ms"]))
                self.assertEqual(overlap, 0)

    def test_diversity_caps_repeated_section_type_even_when_choruses_score_higher(self) -> None:
        duration_ms = 220_000
        sections = [
            ("chorus-a", 10_000, 30_000, "chorus", "Chorus"),
            ("chorus-b", 50_000, 70_000, "chorus", "Chorus"),
            ("chorus-c", 90_000, 110_000, "chorus", "Chorus"),
            ("verse", 130_000, 150_000, "verse", "Verse"),
            ("bridge", 170_000, 190_000, "bridge", "Bridge"),
        ]
        result = {
            "duration_ms": duration_ms,
            "downbeat_source": "model",
            "downbeats_ms": list(range(0, duration_ms + 1, 2000)),
            "bars": _bars(duration_ms, [(section_id, start, end) for section_id, start, end, _, _ in sections]),
            "phrases": [],
            "sections": [
                {"id": section_id, "start_ms": start, "end_ms": end, "type": kind, "label": label, "confidence": 0.95}
                for section_id, start, end, kind, label in sections
            ],
            "hook_candidates_v3": [
                _hook(1, 12_000, 19_000, 0.99, "Chorus", "chorus"),
                _hook(2, 52_000, 59_000, 0.98, "Chorus", "chorus"),
                _hook(3, 92_000, 99_000, 0.97, "Chorus", "chorus"),
                _hook(4, 132_000, 139_000, 0.90, "Verse", "verse", "groove_loop"),
                _hook(5, 172_000, 179_000, 0.89, "Bridge", "bridge", "story_arc"),
            ],
        }

        strongest = build_strongest_moments(result)
        counts: dict[str, int] = {}
        for moment in strongest:
            section_type = str(moment["section_type"])
            counts[section_type] = counts.get(section_type, 0) + 1

        self.assertLessEqual(counts.get("chorus", 0), MAX_PER_SECTION_TYPE)
        self.assertTrue(any(moment["section_type"] == "verse" for moment in strongest))
        self.assertTrue(any(moment["section_type"] == "bridge" for moment in strongest))

    def test_legacy_v3_payload_without_hook_candidates_v3_is_supported(self) -> None:
        result = {
            "duration_ms": 60_000,
            "downbeat_source": "model",
            "downbeats_ms": list(range(0, 60_001, 2000)),
            "bars": [],
            "phrases": [],
            "sections": [
                {"id": "chorus", "start_ms": 20_000, "end_ms": 40_000, "type": "chorus", "label": "Chorus", "confidence": 0.95},
            ],
            "hook_candidates": [_hook(1, 22_000, 29_000, 0.94, "Chorus", "chorus")],
            "analysis": {},
        }

        attach_strongest_moments(result)

        self.assertEqual(len(result["strongest_moments"]), 1)
        self.assertEqual(result["strongest_moments"][0]["start_ms"], 20_000)
        self.assertEqual(result["strongest_moments"][0]["end_ms"], 40_000)
        contract = result["analysis"]["strongest_moments"]
        self.assertEqual(contract["target_duration_ms"], TARGET_VISIBLE_MOMENT_MS)
        self.assertIs(contract["hard_non_overlap"], True)
        self.assertEqual(contract["max_per_section_type"], MAX_PER_SECTION_TYPE)


if __name__ == "__main__":
    unittest.main()
