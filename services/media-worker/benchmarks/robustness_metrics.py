from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path
from typing import Any

DEFAULT_THRESHOLDS = {
    "max_bpm_relative_error": 0.01,
    "max_section_boundary_median_ms": 650.0,
    "min_moment_top3_temporal_recall": 0.8,
    "min_semantic_descriptor_top3_overlap": 0.66,
}


def _nearest_median(reference: list[int], candidate: list[int]) -> float | None:
    if not reference or not candidate:
        return None
    distances = [min(abs(value - other) for other in candidate) for value in reference]
    return float(statistics.median(distances))


def _section_boundaries(analysis: dict[str, Any]) -> list[int]:
    boundaries: set[int] = set()
    for section in analysis.get("sections") or []:
        if not isinstance(section, dict):
            continue
        for key in ("start_ms", "end_ms"):
            value = section.get(key)
            if isinstance(value, (int, float)) and int(value) > 0:
                boundaries.add(int(value))
    duration = int(analysis.get("duration_ms") or 0)
    if duration:
        boundaries.discard(duration)
    return sorted(boundaries)


def _moment_windows(analysis: dict[str, Any], limit: int = 3) -> list[tuple[int, int]]:
    moments = analysis.get("musical_moments") or analysis.get("hook_candidates") or []
    result: list[tuple[int, int]] = []
    for moment in moments:
        if not isinstance(moment, dict):
            continue
        start = int(moment.get("start_ms") or 0)
        end = int(moment.get("end_ms") or 0)
        if end > start:
            result.append((start, end))
        if len(result) >= limit:
            break
    return result


def _iou(left: tuple[int, int], right: tuple[int, int]) -> float:
    intersection = max(0, min(left[1], right[1]) - max(left[0], right[0]))
    union = max(left[1], right[1]) - min(left[0], right[0])
    return intersection / union if union > 0 else 0.0


def _moment_recall(reference: list[tuple[int, int]], candidate: list[tuple[int, int]], threshold: float = 0.35) -> float | None:
    if not reference:
        return None
    if not candidate:
        return 0.0
    matched = sum(any(_iou(window, other) >= threshold for other in candidate) for window in reference)
    return matched / len(reference)


def _descriptor_set(analysis: dict[str, Any], moment_limit: int = 3, descriptor_limit: int = 3) -> set[str]:
    moments = analysis.get("musical_moments") or analysis.get("hook_candidates") or []
    descriptors: set[str] = set()
    for moment in moments[:moment_limit]:
        if not isinstance(moment, dict):
            continue
        for descriptor in (moment.get("semantic_descriptors") or [])[:descriptor_limit]:
            if isinstance(descriptor, dict) and descriptor.get("text"):
                descriptors.add(str(descriptor["text"]))
    return descriptors


def compare_analyses(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
    thresholds: dict[str, float] | None = None,
) -> dict[str, Any]:
    limits = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    baseline_bpm = float(baseline.get("bpm") or 0.0)
    candidate_bpm = float(candidate.get("bpm") or 0.0)
    bpm_relative_error = abs(candidate_bpm - baseline_bpm) / baseline_bpm if baseline_bpm > 0 else None

    boundary_drift = _nearest_median(_section_boundaries(baseline), _section_boundaries(candidate))
    moment_recall = _moment_recall(_moment_windows(baseline), _moment_windows(candidate))

    baseline_descriptors = _descriptor_set(baseline)
    candidate_descriptors = _descriptor_set(candidate)
    descriptor_overlap = None
    if baseline_descriptors:
        descriptor_overlap = len(baseline_descriptors & candidate_descriptors) / len(baseline_descriptors)

    checks = {
        "bpm": bpm_relative_error is None or bpm_relative_error <= limits["max_bpm_relative_error"],
        "section_boundaries": boundary_drift is None or boundary_drift <= limits["max_section_boundary_median_ms"],
        "moments": moment_recall is None or moment_recall >= limits["min_moment_top3_temporal_recall"],
        "semantic_descriptors": descriptor_overlap is None or descriptor_overlap >= limits["min_semantic_descriptor_top3_overlap"],
    }
    return {
        "metrics": {
            "bpm_relative_error": round(bpm_relative_error, 6) if bpm_relative_error is not None else None,
            "section_boundary_median_drift_ms": round(boundary_drift, 2) if boundary_drift is not None else None,
            "moment_top3_temporal_recall": round(moment_recall, 4) if moment_recall is not None else None,
            "semantic_descriptor_top3_overlap": round(descriptor_overlap, 4) if descriptor_overlap is not None else None,
        },
        "thresholds": limits,
        "checks": checks,
        "passed": all(checks.values()),
    }


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: python benchmarks/robustness_metrics.py BASELINE.json VARIANT.json [VARIANT.json ...]", file=sys.stderr)
        return 2
    baseline_path = Path(sys.argv[1])
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    reports = []
    for raw_path in sys.argv[2:]:
        path = Path(raw_path)
        candidate = json.loads(path.read_text(encoding="utf-8"))
        reports.append({"variant": str(path), **compare_analyses(baseline, candidate)})
    payload = {"baseline": str(baseline_path), "variants": reports, "passed": all(report["passed"] for report in reports)}
    print(json.dumps(payload, indent=2))
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
