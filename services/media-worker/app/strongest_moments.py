from __future__ import annotations

from collections import Counter
from typing import Any

MIN_VISIBLE_MOMENT_MS = 12_000
TARGET_VISIBLE_MOMENT_MS = 20_000
MAX_VISIBLE_MOMENT_MS = 32_000
DIVERSITY_GAP_MS = 24_000
MAX_VISIBLE_MOMENTS = 5
MAX_PER_SECTION_TYPE = 2


def _clip01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _overlap_ms(a: dict[str, Any], b: dict[str, Any]) -> int:
    return max(
        0,
        min(int(a["end_ms"]), int(b["end_ms"]))
        - max(int(a["start_ms"]), int(b["start_ms"])),
    )


def _gap_ms(a: dict[str, Any], b: dict[str, Any]) -> int:
    if _overlap_ms(a, b) > 0:
        return 0
    if int(a["end_ms"]) <= int(b["start_ms"]):
        return int(b["start_ms"]) - int(a["end_ms"])
    return int(a["start_ms"]) - int(b["end_ms"])


def _dominant_intent(candidate: dict[str, Any]) -> str:
    scores = candidate.get("intent_scores") or {}
    numeric = {
        str(key): float(value)
        for key, value in scores.items()
        if isinstance(value, (int, float))
    }
    if numeric:
        return max(numeric, key=numeric.get)
    return str(candidate.get("kind") or "musical_identity")


def _section_for(ms: int, result: dict[str, Any]) -> dict[str, Any] | None:
    return next(
        (
            section
            for section in result.get("sections") or []
            if isinstance(section, dict)
            and int(section.get("start_ms") or 0) <= ms < int(section.get("end_ms") or 0)
        ),
        None,
    )


def _add_boundary(
    points: dict[int, dict[str, Any]],
    ms: int,
    *,
    duration_ms: int,
    quality: float,
    kind: str,
) -> None:
    ms = max(0, min(duration_ms, int(ms)))
    current = points.setdefault(ms, {"ms": ms, "quality": 0.0, "kinds": set()})
    current["quality"] = max(float(current["quality"]), _clip01(quality))
    current["kinds"].add(kind)


def _boundary_points(result: dict[str, Any]) -> list[dict[str, Any]]:
    duration_ms = max(1, int(result.get("duration_ms") or 1))
    points: dict[int, dict[str, Any]] = {}
    _add_boundary(points, 0, duration_ms=duration_ms, quality=0.96, kind="track")
    _add_boundary(points, duration_ms, duration_ms=duration_ms, quality=0.96, kind="track")

    for section in result.get("sections") or []:
        if not isinstance(section, dict):
            continue
        confidence = _clip01(float(section.get("boundary_confidence") or section.get("confidence") or 0.55))
        quality = 0.86 + 0.12 * confidence
        for key in ("start_ms", "end_ms"):
            value = section.get(key)
            if isinstance(value, (int, float)):
                _add_boundary(points, int(value), duration_ms=duration_ms, quality=quality, kind="section")

    for phrase in result.get("phrases") or []:
        if not isinstance(phrase, dict):
            continue
        confidence = _clip01(float(phrase.get("confidence") or 0.5))
        quality = 0.78 + 0.16 * confidence
        for key in ("start_ms", "end_ms"):
            value = phrase.get(key)
            if isinstance(value, (int, float)):
                _add_boundary(points, int(value), duration_ms=duration_ms, quality=quality, kind="phrase")

    model_downbeats = str(result.get("downbeat_source") or "none") == "model"
    for bar in result.get("bars") or []:
        if not isinstance(bar, dict):
            continue
        quality = 0.82 if model_downbeats else 0.62
        for key in ("start_ms", "end_ms"):
            value = bar.get(key)
            if isinstance(value, (int, float)):
                _add_boundary(points, int(value), duration_ms=duration_ms, quality=quality, kind="bar")

    downbeat_quality = 0.76 if model_downbeats else 0.56
    for value in result.get("downbeats_ms") or []:
        if isinstance(value, (int, float)):
            _add_boundary(points, int(value), duration_ms=duration_ms, quality=downbeat_quality, kind="downbeat")

    return sorted(points.values(), key=lambda point: int(point["ms"]))


def _exact_section_bonus(left: int, right: int, peak_midpoint: int, result: dict[str, Any]) -> float:
    for section in result.get("sections") or []:
        if not isinstance(section, dict):
            continue
        start = int(section.get("start_ms") or 0)
        end = int(section.get("end_ms") or 0)
        if start == left and end == right and start <= peak_midpoint < end:
            return 1.0
    return 0.0


def _section_crossings(left: int, right: int, result: dict[str, Any]) -> int:
    boundaries = {
        int(section.get("start_ms") or 0)
        for section in result.get("sections") or []
        if isinstance(section, dict)
    }
    return sum(1 for point in boundaries if left < point < right)


def _context_window(peak: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    duration_ms = max(1, int(result.get("duration_ms") or 1))
    peak_start = max(0, min(duration_ms, int(peak.get("start_ms") or 0)))
    peak_end = max(peak_start + 1, min(duration_ms, int(peak.get("end_ms") or peak_start + 1)))
    effective_min = min(MIN_VISIBLE_MOMENT_MS, duration_ms)
    effective_max = min(MAX_VISIBLE_MOMENT_MS, duration_ms)
    target = min(TARGET_VISIBLE_MOMENT_MS, duration_ms)
    peak_midpoint = peak_start + (peak_end - peak_start) // 2
    points = _boundary_points(result)
    left_points = [point for point in points if int(point["ms"]) <= peak_start]
    right_points = [point for point in points if int(point["ms"]) >= peak_end]

    best: tuple[float, dict[str, Any], dict[str, Any]] | None = None
    for left_point in left_points:
        left = int(left_point["ms"])
        if peak_start - left > effective_max:
            continue
        for right_point in right_points:
            right = int(right_point["ms"])
            visible_duration = right - left
            if visible_duration < effective_min or visible_duration > effective_max:
                continue

            duration_fit = _clip01(1.0 - abs(visible_duration - target) / max(target, 1))
            boundary_fit = (float(left_point["quality"]) + float(right_point["quality"])) / 2.0
            visible_midpoint = left + visible_duration / 2.0
            center_fit = _clip01(
                1.0 - abs(visible_midpoint - peak_midpoint) / max(visible_duration / 2.0, 1.0)
            )
            exact_section = _exact_section_bonus(left, right, peak_midpoint, result)
            phrase_edges = float(
                "phrase" in left_point["kinds"] and "phrase" in right_point["kinds"]
            )
            crossing_count = _section_crossings(left, right, result)
            coherence = 1.0 if crossing_count == 0 else max(0.0, 1.0 - 0.35 * crossing_count)
            value = (
                0.38 * duration_fit
                + 0.25 * boundary_fit
                + 0.15 * center_fit
                + 0.14 * exact_section
                + 0.05 * phrase_edges
                + 0.03 * coherence
            )
            if best is None or value > best[0]:
                best = (value, left_point, right_point)

    if best is not None:
        value, left_point, right_point = best
        left, right = int(left_point["ms"]), int(right_point["ms"])
        return {
            "start_ms": left,
            "end_ms": right,
            "duration_ms": right - left,
            "boundary_fit": round(_clip01((float(left_point["quality"]) + float(right_point["quality"])) / 2.0), 4),
            "context_fit": round(_clip01(value), 4),
            "boundary_kinds": {
                "start": sorted(str(value) for value in left_point["kinds"]),
                "end": sorted(str(value) for value in right_point["kinds"]),
            },
        }

    # Boundary metadata may be sparse on legacy/fallback maps. Preserve the scoring
    # window and grow around it to a useful listening duration without exceeding the track.
    desired = min(effective_max, max(effective_min, target, peak_end - peak_start))
    start = max(0, min(peak_start, peak_midpoint - desired // 2))
    end = min(duration_ms, start + desired)
    start = max(0, end - desired)
    if start > peak_start:
        start = peak_start
    if end < peak_end:
        end = peak_end
        start = max(0, end - desired)
    return {
        "start_ms": int(start),
        "end_ms": int(end),
        "duration_ms": int(end - start),
        "boundary_fit": 0.25,
        "context_fit": 0.35,
        "boundary_kinds": {"start": ["free_time"], "end": ["free_time"]},
    }


def _display_candidate(peak: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    context = _context_window(peak, result)
    peak_start = int(peak.get("start_ms") or 0)
    peak_end = int(peak.get("end_ms") or peak_start)
    peak_midpoint = peak_start + max(0, peak_end - peak_start) // 2
    section = _section_for(peak_midpoint, result) or {}
    section_label = str(peak.get("section_label") or section.get("label") or "Musical phrase")
    section_type = str(peak.get("section_type") or section.get("type") or "section")
    intent = _dominant_intent(peak)
    score = _clip01(float(peak.get("score") or 0.0))
    reasons = [str(reason) for reason in peak.get("reasons") or [] if reason]
    reasons.insert(0, "Playback expands the scoring peak to complete musical context.")
    peak_id = str(peak.get("id") or f"peak-{peak_start}-{peak_end}")

    return {
        "id": f"strongest-{peak_id}",
        "label": str(peak.get("label") or f"{intent.replace('_', ' ').title()} · {section_label}"),
        "kind": intent,
        "start_ms": context["start_ms"],
        "end_ms": context["end_ms"],
        "duration_ms": context["duration_ms"],
        "section_id": section.get("id"),
        "section_type": section_type,
        "section_label": section_label,
        "score": round(score, 4),
        "intent_scores": dict(peak.get("intent_scores") or {}),
        "reasons": reasons[:4],
        "peak_window": {
            "candidate_id": peak_id,
            "start_ms": peak_start,
            "end_ms": peak_end,
            "duration_ms": max(0, peak_end - peak_start),
            "score": round(score, 4),
            "target_duration_ms": peak.get("target_duration_ms"),
            "label": peak.get("label"),
        },
        "context": {
            "strategy": "analysis_peak_with_musical_context",
            "target_duration_ms": TARGET_VISIBLE_MOMENT_MS,
            "boundary_fit": context["boundary_fit"],
            "context_fit": context["context_fit"],
            "boundary_kinds": context["boundary_kinds"],
        },
    }


def _dedupe_contexts(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best_by_window: dict[tuple[int, int], dict[str, Any]] = {}
    for candidate in candidates:
        key = (int(candidate["start_ms"]), int(candidate["end_ms"]))
        current = best_by_window.get(key)
        if current is None or float(candidate.get("score") or 0.0) > float(current.get("score") or 0.0):
            best_by_window[key] = candidate
    return sorted(
        best_by_window.values(),
        key=lambda item: (-float(item.get("score") or 0.0), int(item["start_ms"])),
    )


def _select_diverse(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()
    seen_intents: set[str] = set()
    seen_sections: set[str] = set()
    section_type_counts: Counter[str] = Counter()

    while len(selected) < min(MAX_VISIBLE_MOMENTS, len(candidates)):
        best: dict[str, Any] | None = None
        best_value = -1.0
        for candidate in candidates:
            candidate_id = str(candidate.get("id") or "")
            if candidate_id in selected_ids:
                continue
            if any(_overlap_ms(candidate, existing) > 0 for existing in selected):
                continue

            section_type = str(candidate.get("section_type") or "section")
            if section_type_counts[section_type] >= MAX_PER_SECTION_TYPE:
                continue

            intent = str(candidate.get("kind") or "musical_identity")
            section = str(candidate.get("section_id") or candidate.get("section_label") or "")
            value = float(candidate.get("score") or 0.0)
            if intent not in seen_intents:
                value += 0.06
            if section and section not in seen_sections:
                value += 0.04
            if section_type_counts[section_type] == 0:
                value += 0.02

            if selected:
                nearest_gap = min(_gap_ms(candidate, existing) for existing in selected)
                if nearest_gap < DIVERSITY_GAP_MS:
                    value -= 0.08 * (1.0 - nearest_gap / DIVERSITY_GAP_MS)

            value += 0.025 * float((candidate.get("context") or {}).get("context_fit") or 0.0)
            if value > best_value:
                best, best_value = candidate, value

        if best is None:
            break
        selected.append(best)
        selected_ids.add(str(best.get("id") or ""))
        intent = str(best.get("kind") or "musical_identity")
        section = str(best.get("section_id") or best.get("section_label") or "")
        section_type = str(best.get("section_type") or "section")
        seen_intents.add(intent)
        if section:
            seen_sections.add(section)
        section_type_counts[section_type] += 1

    for index, candidate in enumerate(selected, 1):
        candidate["rank"] = index
    return selected


def build_strongest_moments(result: dict[str, Any]) -> list[dict[str, Any]]:
    scoring_windows = [
        candidate
        for candidate in result.get("hook_candidates_v3") or []
        if isinstance(candidate, dict)
        and int(candidate.get("end_ms") or 0) > int(candidate.get("start_ms") or 0)
    ]
    if not scoring_windows:
        # Older v3 payloads do not have hook_candidates_v3 because those windows are
        # themselves the canonical hook_candidates collection.
        scoring_windows = [
            candidate
            for candidate in result.get("hook_candidates") or []
            if isinstance(candidate, dict)
            and int(candidate.get("end_ms") or 0) > int(candidate.get("start_ms") or 0)
        ]

    scoring_windows.sort(
        key=lambda item: (-float(item.get("score") or 0.0), int(item.get("start_ms") or 0))
    )
    contextualized = [_display_candidate(candidate, result) for candidate in scoring_windows]
    return _select_diverse(_dedupe_contexts(contextualized))


def attach_strongest_moments(result: dict[str, Any]) -> dict[str, Any]:
    strongest = build_strongest_moments(result)
    result["strongest_moments"] = strongest
    analysis = result.setdefault("analysis", {})
    analysis["strongest_moments"] = {
        "strategy": "analysis_peak_with_musical_context",
        "visible_limit": MAX_VISIBLE_MOMENTS,
        "minimum_duration_ms": min(MIN_VISIBLE_MOMENT_MS, int(result.get("duration_ms") or MIN_VISIBLE_MOMENT_MS)),
        "target_duration_ms": min(TARGET_VISIBLE_MOMENT_MS, int(result.get("duration_ms") or TARGET_VISIBLE_MOMENT_MS)),
        "maximum_duration_ms": min(MAX_VISIBLE_MOMENT_MS, int(result.get("duration_ms") or MAX_VISIBLE_MOMENT_MS)),
        "hard_non_overlap": True,
        "proximity_penalty_ms": DIVERSITY_GAP_MS,
        "max_per_section_type": MAX_PER_SECTION_TYPE,
        "selected_count": len(strongest),
    }
    return result
