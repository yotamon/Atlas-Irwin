from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


def _seconds(values: list[int | float]) -> np.ndarray:
    return np.asarray([float(value) / 1000.0 for value in values], dtype=np.float64)


def _section_intervals(analysis: dict[str, Any]) -> np.ndarray:
    intervals = []
    for section in analysis.get("sections") or []:
        if not isinstance(section, dict):
            continue
        start = float(section.get("start_ms") or 0.0) / 1000.0
        end = float(section.get("end_ms") or 0.0) / 1000.0
        if end > start:
            intervals.append([start, end])
    return np.asarray(intervals, dtype=np.float64)


def evaluate(annotation: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any]:
    try:
        import mir_eval
    except ImportError as exc:  # pragma: no cover - benchmark-only dependency
        raise RuntimeError(
            "Install services/media-worker/requirements-audio-benchmark.txt before running MIR evaluation."
        ) from exc

    metrics: dict[str, Any] = {}
    expected_beats = _seconds(annotation.get("beats_ms") or [])
    estimated_beats = _seconds(analysis.get("beats_ms") or [])
    if expected_beats.size and estimated_beats.size:
        metrics["beat_f_measure"] = round(float(mir_eval.beat.f_measure(expected_beats, estimated_beats)), 5)

    expected_downbeats = _seconds(annotation.get("downbeats_ms") or [])
    estimated_downbeats = _seconds(analysis.get("downbeats_ms") or [])
    if expected_downbeats.size and estimated_downbeats.size:
        metrics["downbeat_f_measure"] = round(float(mir_eval.beat.f_measure(expected_downbeats, estimated_downbeats)), 5)

    expected_sections = np.asarray(annotation.get("section_intervals_s") or [], dtype=np.float64)
    estimated_sections = _section_intervals(analysis)
    if expected_sections.size and estimated_sections.size:
        precision, recall, f_measure = mir_eval.segment.detection(
            expected_sections,
            estimated_sections,
            window=0.5,
            trim=False,
        )
        metrics["section_boundary_precision_500ms"] = round(float(precision), 5)
        metrics["section_boundary_recall_500ms"] = round(float(recall), 5)
        metrics["section_boundary_f_measure_500ms"] = round(float(f_measure), 5)

    expected_bpm = float(annotation.get("bpm") or annotation.get("expected_bpm") or 0.0)
    estimated_bpm = float(analysis.get("bpm") or 0.0)
    if expected_bpm > 0 and estimated_bpm > 0:
        metrics["bpm_absolute_error"] = round(abs(expected_bpm - estimated_bpm), 5)

    return metrics


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: python benchmarks/evaluate_mir.py ANNOTATION.json ANALYSIS.json", file=sys.stderr)
        return 2
    annotation = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    analysis = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    print(json.dumps(evaluate(annotation, analysis), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
