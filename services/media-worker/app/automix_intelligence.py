from __future__ import annotations

import math
from statistics import median
from typing import Any, Literal

import numpy as np

from .automix_model import _clip01, _list_records, _record, _safe_float, normalize_dj_bpm

TempoClass = Literal["stable", "drifting", "section_tempo_changes", "unstable", "unknown"]


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def mastering_profile(music_map: dict[str, Any]) -> dict[str, Any]:
    inspector = _record(music_map.get("mastering_inspector"))
    qc = _record(music_map.get("master_qc"))
    loudness = _record(inspector.get("loudness"))
    peaks = _record(inspector.get("peaks"))
    dynamics = _record(inspector.get("dynamics"))

    integrated = _number(qc.get("integrated_lufs"))
    if integrated is None:
        integrated = _number(loudness.get("integrated_lufs"))
    true_peak = _number(qc.get("true_peak_dbtp"))
    if true_peak is None:
        true_peak = _number(peaks.get("true_peak_dbtp"))
    clipping_ratio = _number(qc.get("clipping_ratio"))
    if clipping_ratio is None:
        clipping_ratio = _number(peaks.get("clipping_ratio")) or 0.0
    crest = _number(qc.get("crest_factor_db"))
    if crest is None:
        crest = _number(dynamics.get("crest_factor_db"))
    lra = _number(dynamics.get("loudness_range_lu"))
    plr = _number(dynamics.get("peak_to_loudness_ratio_lu"))
    technical_ready = bool(qc.get("technical_ready", inspector.get("technical_ready", True)))

    issue_counts = _record(inspector.get("issue_counts"))
    critical = int(_safe_float(issue_counts.get("critical"), 0.0))
    warning = int(_safe_float(issue_counts.get("warning"), 0.0))
    score = 1.0
    if not technical_ready:
        score -= 0.25
    score -= min(0.40, critical * 0.20)
    score -= min(0.18, warning * 0.035)
    if clipping_ratio and clipping_ratio > 0:
        score -= min(0.30, 0.08 + math.log10(1.0 + clipping_ratio * 1_000_000.0) * 0.05)
    if true_peak is not None and true_peak > -0.1:
        score -= 0.06
    return {
        "integrated_lufs": integrated,
        "true_peak_dbtp": true_peak,
        "crest_factor_db": crest,
        "lra_lu": lra,
        "plr_lu": plr,
        "clipping_ratio": clipping_ratio or 0.0,
        "technical_ready": technical_ready,
        "quality_score": round(_clip01(score), 4),
        "critical_issues": critical,
        "warning_issues": warning,
    }


def _beat_stability(music_map: dict[str, Any]) -> dict[str, Any]:
    direct = _record(music_map.get("beat_stability"))
    if direct:
        return direct
    return _record(_record(music_map.get("mastering_inspector")).get("beat_stability"))


def _timeline_points(music_map: dict[str, Any], start_ms: int, end_ms: int) -> list[tuple[int, float]]:
    stability = _beat_stability(music_map)
    points: list[tuple[int, float]] = []
    for item in _list_records(stability.get("timeline")):
        ms = int(_safe_float(item.get("ms"), -1.0))
        bpm = _safe_float(item.get("bpm"), 0.0)
        if start_ms <= ms <= end_ms and bpm > 0:
            points.append((ms, normalize_dj_bpm(bpm)))
    return points


def tempo_profile(music_map: dict[str, Any], start_ms: int, end_ms: int, fallback_bpm: float) -> dict[str, Any]:
    stability = _beat_stability(music_map)
    classification = str(stability.get("classification") or "unknown")
    if classification not in {"stable", "drifting", "section_tempo_changes", "unstable", "unknown"}:
        classification = "unknown"
    confidence = _clip01(_safe_float(stability.get("confidence"), 0.45 if stability else 0.25))
    fallback = normalize_dj_bpm(fallback_bpm)
    points = _timeline_points(music_map, start_ms, end_ms)
    values = [bpm for _, bpm in points]
    local_median = float(np.median(values)) if values else fallback
    local_span = float(np.percentile(values, 95) - np.percentile(values, 5)) if len(values) >= 4 else 0.0
    window_ms = max(1, end_ms - start_ms)
    edge_ms = min(24_000, max(8_000, int(window_ms * 0.22)))
    entry = [bpm for ms, bpm in points if ms <= start_ms + edge_ms]
    exit_ = [bpm for ms, bpm in points if ms >= end_ms - edge_ms]
    entry_bpm = float(median(entry)) if entry else local_median
    exit_bpm = float(median(exit_)) if exit_ else local_median
    span_ratio = local_span / max(1.0, local_median)
    jitter = _safe_float(stability.get("local_jitter_bpm"), 0.0)

    if classification == "stable":
        reliability = 0.96
        constant_stretch_safe = span_ratio <= 0.018
    elif classification == "section_tempo_changes":
        reliability = 0.86 if span_ratio <= 0.018 else 0.62
        constant_stretch_safe = span_ratio <= 0.018
    elif classification == "drifting":
        reliability = 0.72 if span_ratio <= 0.014 and jitter <= 1.25 else 0.48
        constant_stretch_safe = span_ratio <= 0.010 and jitter <= 0.9
    elif classification == "unstable":
        reliability = 0.22
        constant_stretch_safe = False
    else:
        reliability = 0.55 if not points else 0.65
        constant_stretch_safe = span_ratio <= 0.012
    reliability *= 0.72 + confidence * 0.28
    return {
        "classification": classification,
        "confidence": round(confidence, 4),
        "window_bpm": round(local_median, 4),
        "entry_bpm": round(entry_bpm, 4),
        "exit_bpm": round(exit_bpm, 4),
        "central_90_span_bpm": round(local_span, 4),
        "span_ratio": round(span_ratio, 6),
        "local_jitter_bpm": round(jitter, 4),
        "reliability": round(_clip01(reliability), 4),
        "constant_stretch_safe": bool(constant_stretch_safe),
        "timeline_point_count": len(points),
    }


def _curve_from_map(music_map: dict[str, Any], category: str) -> list[dict[str, Any]]:
    direct = music_map.get(f"automix_{category}_activity_curve")
    if isinstance(direct, list):
        return _list_records(direct)
    stem_bundle = _record(music_map.get("automix_stem_intelligence"))
    stem = _record(stem_bundle.get(category))
    return _list_records(stem.get("activity_curve"))


def activity_score(music_map: dict[str, Any], category: str, start_ms: int, end_ms: int) -> tuple[float, float]:
    curve = _curve_from_map(music_map, category)
    scores: list[float] = []
    for item in curve:
        item_start = int(_safe_float(item.get("start_ms"), -1.0))
        item_end = int(_safe_float(item.get("end_ms"), item_start + 500.0))
        if item_end <= start_ms or item_start >= end_ms:
            continue
        active_ratio = _clip01(_safe_float(item.get("active_ratio"), 0.0))
        energy = _clip01(_safe_float(item.get("energy"), 0.0))
        active = 1.0 if bool(item.get("active")) else 0.0
        scores.append(_clip01(active_ratio * 0.52 + energy * 0.33 + active * 0.15))
    if scores:
        return float(np.mean(scores)), min(1.0, 0.72 + len(scores) / 40.0)

    # Conservative fallback from structural labels. This never claims stem-level certainty.
    structural: list[float] = []
    for section in _list_records(music_map.get("sections")):
        section_start = int(_safe_float(section.get("start_ms"), 0.0))
        section_end = int(_safe_float(section.get("end_ms"), 0.0))
        if section_end <= start_ms or section_start >= end_ms:
            continue
        label = str(section.get("label") or "").lower()
        if any(token in label for token in ("instrumental", "intro", "outro", "break", "bridge")):
            structural.append(0.18)
        elif any(token in label for token in ("verse", "chorus", "hook", "vocal")):
            structural.append(0.78 if category == "vocals" else 0.55)
        else:
            structural.append(0.46)
    if structural:
        return float(np.mean(structural)), 0.38
    return 0.45, 0.18


def transition_activity(a_map: dict[str, Any], a_end_ms: int, b_map: dict[str, Any], b_start_ms: int, overlap_ms: int) -> dict[str, float]:
    window = max(4_000, overlap_ms or 12_000)
    a_start = max(0, a_end_ms - window)
    b_end = b_start_ms + window
    a_vocal, a_vocal_conf = activity_score(a_map, "vocals", a_start, a_end_ms)
    b_vocal, b_vocal_conf = activity_score(b_map, "vocals", b_start_ms, b_end)
    a_bass, a_bass_conf = activity_score(a_map, "bass", a_start, a_end_ms)
    b_bass, b_bass_conf = activity_score(b_map, "bass", b_start_ms, b_end)
    vocal_collision = _clip01(min(a_vocal, b_vocal) * math.sqrt(a_vocal_conf * b_vocal_conf))
    bass_collision = _clip01(min(a_bass, b_bass) * math.sqrt(a_bass_conf * b_bass_conf))
    return {
        "a_vocal": round(a_vocal, 4),
        "b_vocal": round(b_vocal, 4),
        "vocal_confidence": round(math.sqrt(a_vocal_conf * b_vocal_conf), 4),
        "vocal_collision": round(vocal_collision, 4),
        "a_bass": round(a_bass, 4),
        "b_bass": round(b_bass, 4),
        "bass_confidence": round(math.sqrt(a_bass_conf * b_bass_conf), 4),
        "bass_collision": round(bass_collision, 4),
    }
