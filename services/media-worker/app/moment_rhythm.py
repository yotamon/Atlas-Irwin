from __future__ import annotations

from statistics import median
from typing import Any

MIN_VISIBLE_MOMENT_MS = 12_000
TARGET_VISIBLE_MOMENT_MS = 20_000
MAX_VISIBLE_MOMENT_MS = 32_000


def _clip01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _overlap_ms(a: dict[str, Any], b: dict[str, Any]) -> int:
    return max(
        0,
        min(int(a.get("end_ms") or 0), int(b.get("end_ms") or 0))
        - max(int(a.get("start_ms") or 0), int(b.get("start_ms") or 0)),
    )


def _positive_ints(values: Any, duration_ms: int) -> list[int]:
    result: set[int] = set()
    for value in values or []:
        if isinstance(value, (int, float)):
            normalized = max(0, min(duration_ms, int(round(value))))
            result.add(normalized)
    return sorted(result)


def _beat_period_ms(result: dict[str, Any], beats: list[int]) -> float | None:
    differences = [
        right - left
        for left, right in zip(beats[:-1], beats[1:])
        if 140 <= right - left <= 2_200
    ]
    if differences:
        return float(median(differences))
    bpm = result.get("bpm")
    if isinstance(bpm, (int, float)) and 25 <= float(bpm) <= 300:
        return 60_000.0 / float(bpm)
    return None


def _nearest(value: int, points: list[int]) -> tuple[int, int] | None:
    if not points:
        return None
    best = min(points, key=lambda point: (abs(point - value), point))
    return best, abs(best - value)


def _add_anchor(
    anchors: dict[int, dict[str, Any]],
    ms: int,
    *,
    quality: float,
    kind: str,
) -> None:
    current = anchors.setdefault(
        int(ms),
        {"ms": int(ms), "quality": 0.0, "kinds": set()},
    )
    current["quality"] = max(float(current["quality"]), _clip01(quality))
    current["kinds"].add(kind)


def _rhythm_grid(result: dict[str, Any]) -> dict[str, Any]:
    duration_ms = max(1, int(result.get("duration_ms") or 1))
    beats = _positive_ints(result.get("beats_ms"), duration_ms)
    downbeats = _positive_ints(result.get("downbeats_ms"), duration_ms)
    bar_points: list[int] = []
    for bar in result.get("bars") or []:
        if not isinstance(bar, dict):
            continue
        for key in ("start_ms", "end_ms"):
            value = bar.get(key)
            if isinstance(value, (int, float)):
                bar_points.append(max(0, min(duration_ms, int(round(value)))))
    bar_points = sorted(set(bar_points))

    period_ms = _beat_period_ms(result, beats)
    beat_confidence = _clip01(float(result.get("beat_confidence") or 0.0))
    downbeat_source = str(
        result.get("downbeat_source")
        or (result.get("analysis") or {}).get("downbeat_source")
        or "none"
    )

    anchors: dict[int, dict[str, Any]] = {}
    source = "none"

    if beats:
        source = "canonical_beats"
        beat_quality = 0.72 + 0.20 * beat_confidence
        for beat in beats:
            _add_anchor(anchors, beat, quality=beat_quality, kind="beat")

        tolerance = max(70.0, min(180.0, (period_ms or 500.0) * 0.32))
        for downbeat in downbeats:
            nearest = _nearest(downbeat, beats)
            if nearest is None:
                continue
            beat, error = nearest
            quality = 0.99 if downbeat_source == "model" else 0.86
            if error <= tolerance:
                _add_anchor(anchors, beat, quality=quality, kind="downbeat")

        for bar_point in bar_points:
            nearest = _nearest(bar_point, beats)
            if nearest is None:
                continue
            beat, error = nearest
            if error <= tolerance:
                _add_anchor(
                    anchors,
                    beat,
                    quality=0.96 if downbeat_source == "model" else 0.84,
                    kind="bar",
                )
    elif downbeats:
        source = "downbeats"
        for downbeat in downbeats:
            _add_anchor(
                anchors,
                downbeat,
                quality=0.98 if downbeat_source == "model" else 0.82,
                kind="downbeat",
            )
    elif bar_points:
        source = "bar_grid"
        for bar_point in bar_points:
            _add_anchor(
                anchors,
                bar_point,
                quality=0.88 if downbeat_source == "model" else 0.72,
                kind="bar",
            )

    # Track edges are natural cut points even if the beat tracker does not emit them.
    if anchors:
        _add_anchor(anchors, 0, quality=0.98, kind="track")
        _add_anchor(anchors, duration_ms, quality=0.98, kind="track")

    return {
        "available": bool(anchors),
        "source": source,
        "beat_period_ms": period_ms,
        "anchors": sorted(anchors.values(), key=lambda item: int(item["ms"])),
    }


def _semantic_boundaries(result: dict[str, Any]) -> list[int]:
    duration_ms = max(1, int(result.get("duration_ms") or 1))
    points: set[int] = {0, duration_ms}
    for collection in ("sections", "phrases"):
        for item in result.get(collection) or []:
            if not isinstance(item, dict):
                continue
            for key in ("start_ms", "end_ms"):
                value = item.get(key)
                if isinstance(value, (int, float)):
                    points.add(max(0, min(duration_ms, int(round(value)))))
    return sorted(points)


def _semantic_fit(ms: int, boundaries: list[int], beat_period_ms: float | None) -> float:
    if not boundaries:
        return 0.0
    nearest = min(abs(ms - boundary) for boundary in boundaries)
    tolerance = max(120.0, min(900.0, (beat_period_ms or 500.0) * 1.25))
    return _clip01(1.0 - nearest / tolerance)


def _anchor_label(anchor: dict[str, Any]) -> str:
    kinds = set(str(value) for value in anchor.get("kinds") or [])
    for preferred in ("downbeat", "bar", "beat", "track"):
        if preferred in kinds:
            return preferred
    return "rhythm"


def _is_rhythm_anchor(anchor: dict[str, Any]) -> bool:
    kinds = set(str(value) for value in anchor.get("kinds") or [])
    return bool(kinds.intersection({"beat", "downbeat", "bar", "track"}))


def _sync_one(
    moment: dict[str, Any],
    *,
    result: dict[str, Any],
    grid: dict[str, Any],
    semantic_boundaries: list[int],
    avoid: list[dict[str, Any]],
) -> dict[str, Any] | None:
    duration_ms = max(1, int(result.get("duration_ms") or 1))
    peak = moment.get("peak_window") if isinstance(moment.get("peak_window"), dict) else moment
    peak_start = max(0, min(duration_ms, int(peak.get("start_ms") or moment.get("start_ms") or 0)))
    peak_end = max(
        peak_start + 1,
        min(duration_ms, int(peak.get("end_ms") or moment.get("end_ms") or peak_start + 1)),
    )
    current_start = max(0, min(peak_start, int(moment.get("start_ms") or peak_start)))
    current_end = min(duration_ms, max(peak_end, int(moment.get("end_ms") or peak_end)))
    original_duration = max(1, current_end - current_start)
    effective_min = min(MIN_VISIBLE_MOMENT_MS, duration_ms)
    effective_max = min(MAX_VISIBLE_MOMENT_MS, duration_ms)
    target_duration = max(
        effective_min,
        min(effective_max, original_duration or min(TARGET_VISIBLE_MOMENT_MS, duration_ms)),
    )
    beat_period_ms = grid.get("beat_period_ms")
    edge_tolerance = max(250.0, min(2_000.0, (beat_period_ms or 500.0) * 2.2))

    left_anchors = [
        anchor for anchor in grid["anchors"]
        if int(anchor["ms"]) <= peak_start and _is_rhythm_anchor(anchor)
    ]
    right_anchors = [
        anchor for anchor in grid["anchors"]
        if int(anchor["ms"]) >= peak_end and _is_rhythm_anchor(anchor)
    ]

    best: tuple[float, dict[str, Any], dict[str, Any]] | None = None
    for left_anchor in left_anchors:
        left = int(left_anchor["ms"])
        if peak_start - left > effective_max:
            continue
        for right_anchor in right_anchors:
            right = int(right_anchor["ms"])
            visible_duration = right - left
            if visible_duration < effective_min or visible_duration > effective_max:
                continue
            candidate_window = {"start_ms": left, "end_ms": right}
            if any(_overlap_ms(candidate_window, existing) > 0 for existing in avoid):
                continue

            duration_fit = _clip01(
                1.0 - abs(visible_duration - target_duration) / max(target_duration, 1)
            )
            left_edge_fit = _clip01(1.0 - abs(left - current_start) / edge_tolerance)
            right_edge_fit = _clip01(1.0 - abs(right - current_end) / edge_tolerance)
            edge_fit = (left_edge_fit + right_edge_fit) / 2.0
            anchor_quality = (
                float(left_anchor.get("quality") or 0.0)
                + float(right_anchor.get("quality") or 0.0)
            ) / 2.0
            semantic_fit = (
                _semantic_fit(left, semantic_boundaries, beat_period_ms)
                + _semantic_fit(right, semantic_boundaries, beat_period_ms)
            ) / 2.0
            visible_midpoint = left + visible_duration / 2.0
            peak_midpoint = peak_start + (peak_end - peak_start) / 2.0
            center_fit = _clip01(
                1.0 - abs(visible_midpoint - peak_midpoint) / max(visible_duration / 2.0, 1.0)
            )
            start_kinds = set(str(value) for value in left_anchor.get("kinds") or [])
            end_kinds = set(str(value) for value in right_anchor.get("kinds") or [])
            start_downbeat = float(bool(start_kinds.intersection({"downbeat", "bar", "track"})))
            end_downbeat = float(bool(end_kinds.intersection({"downbeat", "bar", "track"})))

            value = (
                0.24 * duration_fit
                + 0.24 * edge_fit
                + 0.22 * anchor_quality
                + 0.14 * semantic_fit
                + 0.08 * center_fit
                + 0.055 * start_downbeat
                + 0.025 * end_downbeat
            )
            if best is None or value > best[0]:
                best = (value, left_anchor, right_anchor)

    if best is None:
        return None

    value, left_anchor, right_anchor = best
    left, right = int(left_anchor["ms"]), int(right_anchor["ms"])
    synchronized = dict(moment)
    synchronized["start_ms"] = left
    synchronized["end_ms"] = right
    synchronized["duration_ms"] = right - left
    context = dict(moment.get("context") or {})
    context["rhythm_sync"] = {
        "beat_locked": True,
        "grid_source": grid.get("source") or "none",
        "beat_period_ms": round(float(beat_period_ms), 2) if beat_period_ms else None,
        "start_anchor": _anchor_label(left_anchor),
        "end_anchor": _anchor_label(right_anchor),
        "start_shift_ms": left - current_start,
        "end_shift_ms": right - current_end,
        "sync_fit": round(_clip01(value), 4),
    }
    synchronized["context"] = context
    reasons = [str(reason) for reason in synchronized.get("reasons") or [] if reason]
    rhythm_reason = "Playback starts and ends on the canonical rhythm grid."
    if rhythm_reason not in reasons:
        reasons.insert(0, rhythm_reason)
    synchronized["reasons"] = reasons[:4]
    return synchronized


def beat_sync_strongest_moments(result: dict[str, Any]) -> dict[str, Any]:
    moments = [
        moment
        for moment in result.get("strongest_moments") or []
        if isinstance(moment, dict)
        and int(moment.get("end_ms") or 0) > int(moment.get("start_ms") or 0)
    ]
    if not moments:
        return result

    grid = _rhythm_grid(result)
    analysis = result.setdefault("analysis", {})
    strongest_contract = analysis.setdefault("strongest_moments", {})

    if not grid["available"]:
        for moment in moments:
            context = dict(moment.get("context") or {})
            context["rhythm_sync"] = {
                "beat_locked": False,
                "grid_source": "none",
                "reason": "No trustworthy beat, downbeat, or bar anchors were available.",
            }
            moment["context"] = context
        strongest_contract["rhythm_sync"] = {
            "policy": "hard_lock_when_canonical_rhythm_grid_available",
            "grid_source": "none",
            "beat_locked_count": 0,
            "selected_count": len(moments),
        }
        return result

    semantic_boundaries = _semantic_boundaries(result)
    synchronized: list[dict[str, Any]] = []
    for moment in sorted(
        moments,
        key=lambda item: (int(item.get("rank") or 10_000), -float(item.get("score") or 0.0)),
    ):
        synced = _sync_one(
            moment,
            result=result,
            grid=grid,
            semantic_boundaries=semantic_boundaries,
            avoid=synchronized,
        )
        if synced is not None:
            synchronized.append(synced)

    # When a rhythm grid exists, do not re-introduce an unsynchronized fallback merely
    # to hit a quota. Four beat-locked moments are more truthful than five sloppy cuts.
    for index, moment in enumerate(synchronized, 1):
        moment["rank"] = index

    result["strongest_moments"] = synchronized
    strongest_contract["rhythm_sync"] = {
        "policy": "hard_lock_when_canonical_rhythm_grid_available",
        "grid_source": grid.get("source") or "none",
        "beat_period_ms": round(float(grid["beat_period_ms"]), 2) if grid.get("beat_period_ms") else None,
        "beat_locked_count": len(synchronized),
        "selected_count": len(synchronized),
        "preserve_peak_window": True,
        "hard_non_overlap_after_sync": True,
    }
    return result
