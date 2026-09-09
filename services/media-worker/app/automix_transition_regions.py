from __future__ import annotations

import math
from typing import Any, Literal

from .automix_intelligence import activity_score, transition_boundary_evidence
from .automix_model import _clip01, _list_records, _record, _safe_float

Direction = Literal["entry", "exit"]


def _candidate_points(music_map: dict[str, Any], target_ms: int, direction: Direction, radius_ms: int) -> list[tuple[int, str, float]]:
    duration = int(music_map.get("duration_ms") or 0)
    if direction == "entry":
        low, high = max(0, target_ms), min(duration, target_ms + radius_ms)
    else:
        low, high = max(0, target_ms - radius_ms), min(duration, target_ms)
    points: dict[int, tuple[str, float]] = {target_ms: ("window_edge", 0.40)}

    for section in _list_records(music_map.get("sections")):
        confidence = _clip01(_safe_float(section.get("boundary_confidence"), _safe_float(section.get("confidence"), 0.55)))
        label = str(section.get("label") or "section").lower()
        keys = ("start_ms",) if direction == "entry" else ("end_ms",)
        for key in keys:
            ms = int(_safe_float(section.get(key), -1.0))
            if low <= ms <= high:
                previous = points.get(ms, ("", 0.0))[1]
                if confidence > previous:
                    points[ms] = (f"section:{label}", confidence)

    for phrase in _list_records(music_map.get("phrases")):
        confidence = _clip01(_safe_float(phrase.get("confidence"), 0.5))
        for key in (("start_ms",) if direction == "entry" else ("end_ms",)):
            ms = int(_safe_float(phrase.get(key), -1.0))
            if low <= ms <= high:
                score = _clip01(0.12 + 0.78 * confidence)
                if score > points.get(ms, ("", 0.0))[1]:
                    points[ms] = ("phrase", score)

    downbeat_source = str(music_map.get("downbeat_source") or "")
    downbeat_conf = 0.94 if downbeat_source == "model" else 0.66 if downbeat_source == "inferred_from_beats" else 0.48
    for raw in music_map.get("downbeats_ms") or []:
        if not isinstance(raw, (int, float)):
            continue
        ms = int(raw)
        if low <= ms <= high and downbeat_conf > points.get(ms, ("", 0.0))[1]:
            points[ms] = ("downbeat", downbeat_conf)
    return [(ms, label, confidence) for ms, (label, confidence) in points.items() if low <= ms <= high]


def _protected_moment_penalty(music_map: dict[str, Any], ms: int) -> float:
    strongest: list[dict[str, Any]] = []
    moments = _record(music_map.get("moments"))
    for group in moments.values():
        strongest.extend(_list_records(group))
    strongest.extend(_list_records(music_map.get("hook_candidates")))
    penalty = 0.0
    for item in strongest:
        start = int(_safe_float(item.get("start_ms"), -1.0))
        end = int(_safe_float(item.get("end_ms"), -1.0))
        score = _clip01(_safe_float(item.get("score"), 0.0))
        if start <= ms <= end and score >= 0.72:
            penalty = max(penalty, 0.18 + 0.42 * score)
    return _clip01(penalty)


def _energy_slope(music_map: dict[str, Any], ms: int, window_ms: int = 8_000) -> float:
    curve = _list_records(music_map.get("energy_curve"))
    before: list[float] = []
    after: list[float] = []
    for item in curve:
        point_ms = int(_safe_float(item.get("ms"), _safe_float(item.get("start_ms"), -1.0)))
        value = _safe_float(item.get("value"), -1.0)
        if value < 0:
            continue
        if ms - window_ms <= point_ms < ms:
            before.append(value)
        elif ms <= point_ms <= ms + window_ms:
            after.append(value)
    if not before or not after:
        return 0.0
    return max(-1.0, min(1.0, (sum(after) / len(after)) - (sum(before) / len(before))))


def choose_transition_region(
    music_map: dict[str, Any],
    target_ms: int,
    direction: Direction,
    *,
    radius_ms: int = 18_000,
) -> dict[str, Any]:
    candidates = _candidate_points(music_map, target_ms, direction, radius_ms)
    if not candidates:
        evidence = transition_boundary_evidence(music_map, target_ms, direction)
        return {"ms": target_ms, "score": 0.35, "label": "window_edge", "evidence": evidence}

    best: tuple[float, dict[str, Any]] | None = None
    for ms, label, source_confidence in candidates:
        evidence = transition_boundary_evidence(music_map, ms, direction)
        boundary = float(evidence.get("boundary_confidence") or 0.0)
        suitability = float(evidence.get("suitability") or 0.0)
        vocals, vocal_conf = activity_score(music_map, "vocals", max(0, ms - 8_000), ms + 8_000)
        bass, bass_conf = activity_score(music_map, "bass", max(0, ms - 8_000), ms + 8_000)
        sparse = _clip01(1.0 - (0.62 * vocals + 0.38 * bass))
        activity_conf = math.sqrt(max(0.0, vocal_conf) * max(0.0, bass_conf))
        distance = abs(ms - target_ms) / max(1.0, radius_ms)
        proximity = _clip01(1.0 - distance)
        protected = _protected_moment_penalty(music_map, ms)
        slope = _energy_slope(music_map, ms)
        slope_fit = _clip01(0.5 + (-slope if direction == "exit" else slope) * 0.35)
        score = _clip01(
            0.28 * boundary
            + 0.24 * suitability
            + 0.15 * sparse
            + 0.11 * source_confidence
            + 0.10 * proximity
            + 0.06 * activity_conf
            + 0.06 * slope_fit
            - 0.28 * protected
        )
        item = {
            "ms": ms,
            "score": round(score, 4),
            "label": label,
            "boundary_confidence": round(boundary, 4),
            "suitability": round(suitability, 4),
            "vocal_activity": round(vocals, 4),
            "bass_activity": round(bass, 4),
            "activity_confidence": round(activity_conf, 4),
            "energy_slope": round(slope, 4),
            "protected_moment_penalty": round(protected, 4),
            "distance_from_original_ms": ms - target_ms,
            "evidence": evidence,
        }
        if best is None or score > best[0]:
            best = (score, item)
    return best[1] if best else {"ms": target_ms, "score": 0.0, "label": "window_edge"}
