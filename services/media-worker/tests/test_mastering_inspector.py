from __future__ import annotations

import unittest

from app.mastering_inspector import analyze_beat_stability


def _steady_beats(bpm: float, seconds: float) -> list[int]:
    interval = 60000.0 / bpm
    values: list[int] = []
    current = 0.0
    while current < seconds * 1000.0:
        values.append(int(round(current)))
        current += interval
    return values


def _drifting_beats(start_bpm: float, end_bpm: float, seconds: float) -> list[int]:
    values = [0]
    current = 0.0
    duration_ms = seconds * 1000.0
    while current < duration_ms:
        ratio = min(1.0, current / duration_ms)
        bpm = start_bpm + (end_bpm - start_bpm) * ratio
        current += 60000.0 / bpm
        if current < duration_ms:
            values.append(int(round(current)))
    return values


def _section_change_beats(first_bpm: float, second_bpm: float, split_ms: int, end_ms: int) -> list[int]:
    values = [0]
    current = 0.0
    while current < split_ms:
        current += 60000.0 / first_bpm
        if current < split_ms:
            values.append(int(round(current)))
    current = float(split_ms)
    values.append(split_ms)
    while current < end_ms:
        current += 60000.0 / second_bpm
        if current < end_ms:
            values.append(int(round(current)))
    return sorted(set(values))


def _jittered_beats(bpm: float, seconds: float) -> list[int]:
    interval = 60000.0 / bpm
    values: list[int] = []
    current = 0.0
    offsets = (-4.0, 2.0, 4.0, -2.0, 0.0)
    index = 0
    while current < seconds * 1000.0:
        values.append(max(0, int(round(current + offsets[index % len(offsets)]))))
        current += interval
        index += 1
    return values


class BeatStabilityTest(unittest.TestCase):
    def test_constant_tempo_is_stable(self) -> None:
        result = analyze_beat_stability(
            _steady_beats(120.0, 120.0),
            global_bpm=120.0,
            sections=[],
            rhythm_confidence=0.95,
        )
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["classification"], "stable")
        self.assertLess(float(result["central_90_span_bpm"]), 0.1)
        self.assertGreater(float(result["stable_ratio"]), 0.98)
        self.assertEqual(result["issues"], [])

    def test_gradual_suno_style_tempo_drift_is_detected(self) -> None:
        result = analyze_beat_stability(
            _drifting_beats(120.0, 116.0, 150.0),
            global_bpm=120.0,
            sections=[],
            rhythm_confidence=0.92,
        )
        self.assertIn(result["classification"], {"drifting", "unstable"})
        self.assertGreater(float(result["central_90_span_bpm"]), 2.0)
        review = [issue for issue in result["issues"] if issue["severity"] == "review"]
        self.assertTrue(review)
        self.assertIn(review[0]["code"], {"tempo_drift", "beat_instability"})

    def test_clean_section_aligned_tempo_change_is_not_called_a_defect(self) -> None:
        sections = [
            {"id": "verse", "label": "Verse", "start_ms": 0, "end_ms": 60000},
            {"id": "chorus", "label": "Chorus", "start_ms": 60000, "end_ms": 120000},
        ]
        result = analyze_beat_stability(
            _section_change_beats(120.0, 124.0, 60000, 120000),
            global_bpm=120.0,
            sections=sections,
            rhythm_confidence=0.94,
        )
        self.assertEqual(result["classification"], "section_tempo_changes")
        self.assertTrue(result["section_tempo_steps"])
        self.assertTrue(result["issues"])
        self.assertTrue(all(issue["severity"] == "info" for issue in result["issues"]))

    def test_small_timing_jitter_does_not_create_a_false_alarm(self) -> None:
        result = analyze_beat_stability(
            _jittered_beats(122.0, 120.0),
            global_bpm=122.0,
            sections=[],
            rhythm_confidence=0.9,
        )
        self.assertEqual(result["classification"], "stable")
        self.assertLess(float(result["central_90_span_bpm"]), 1.0)

    def test_too_few_beats_stays_unknown(self) -> None:
        result = analyze_beat_stability(
            [0, 500, 1000, 1500],
            global_bpm=120.0,
            sections=[],
            rhythm_confidence=0.9,
        )
        self.assertEqual(result["status"], "insufficient_evidence")
        self.assertEqual(result["classification"], "unknown")


if __name__ == "__main__":
    unittest.main()
