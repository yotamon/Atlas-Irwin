from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import librosa
import numpy as np
import soundfile as sf

try:
    import pyloudnorm as pyln
except Exception:  # pragma: no cover - QC gracefully degrades if bootstrap is incomplete
    pyln = None

try:
    import allin1_infer
except Exception:  # pragma: no cover - deployment fallback is intentional
    allin1_infer = None


ANALYSIS_VERSION = 3
ANALYSIS_CONFIG = "atlas-ti-v3.0.0"
SOCIAL_DURATIONS_MS = (6000, 8000, 15000, 30000)
MOMENT_INTENTS = (
    "instant_hook",
    "musical_identity",
    "groove_loop",
    "build_drop",
    "climax",
    "story_arc",
)
SEMANTIC_TYPES = {"intro", "outro", "break", "bridge", "inst", "solo", "verse", "chorus"}
SEMANTIC_LABELS = ["start", "end", "intro", "outro", "break", "bridge", "inst", "solo", "verse", "chorus"]


def _normalized(values: np.ndarray) -> np.ndarray:
    if values.size == 0:
        return values.astype(float)
    low, high = float(np.min(values)), float(np.max(values))
    if math.isclose(high, low):
        return np.full_like(values, 0.5, dtype=float)
    return (values.astype(float) - low) / (high - low)


def _clip01(value: float) -> float:
    return float(np.clip(value, 0.0, 1.0))


def _db(value: float, floor: float = -120.0) -> float:
    if not np.isfinite(value) or value <= 1e-12:
        return floor
    return max(floor, 20.0 * math.log10(value))


def _mean_between(
    values: np.ndarray,
    times_ms: np.ndarray,
    start_ms: int,
    end_ms: int,
    default: float = 0.5,
) -> float:
    mask = (times_ms >= start_ms) & (times_ms < end_ms)
    local = values[mask]
    return float(np.mean(local)) if local.size else default


def _nearest(value_ms: int, points_ms: list[int], duration_ms: int) -> int:
    if not points_ms:
        return max(0, min(duration_ms, value_ms))
    return min(points_ms, key=lambda item: abs(item - value_ms))


def _next_point(value_ms: int, points_ms: list[int], duration_ms: int) -> int:
    for item in points_ms:
        if item >= value_ms:
            return item
    return duration_ms


def _section_energy(sections: list[dict[str, Any]], rms: np.ndarray, rms_times_ms: np.ndarray) -> None:
    for section in sections:
        section["energy"] = round(
            _mean_between(rms, rms_times_ms, int(section["start_ms"]), int(section["end_ms"])),
            4,
        )


def _activation_at(values: np.ndarray | None, fps: float | None, ms: int, radius_ms: int = 120) -> float | None:
    if values is None or not fps or fps <= 0 or values.size == 0:
        return None
    center = int(round(ms / 1000.0 * fps))
    radius = max(1, int(round(radius_ms / 1000.0 * fps)))
    lo, hi = max(0, center - radius), min(values.shape[-1], center + radius + 1)
    if hi <= lo:
        return None
    return _clip01(float(np.max(values[..., lo:hi])))


def _label_confidence(
    label_activations: np.ndarray | None,
    fps: float | None,
    label: str,
    start_ms: int,
    end_ms: int,
) -> float | None:
    if label_activations is None or not fps or fps <= 0 or label_activations.ndim != 2:
        return None
    try:
        label_index = SEMANTIC_LABELS.index(label)
    except ValueError:
        return None
    if label_index >= label_activations.shape[0]:
        return None
    lo = max(0, int(round(start_ms / 1000.0 * fps)))
    hi = min(label_activations.shape[1], int(round(end_ms / 1000.0 * fps)))
    if hi <= lo:
        return None
    local = label_activations[label_index, lo:hi]
    if local.size == 0:
        return None
    return _clip01(float(np.median(local)))


def _prepare_embeddings(embeddings: Any) -> np.ndarray | None:
    if embeddings is None:
        return None
    array = np.asarray(embeddings, dtype=np.float32)
    if array.ndim == 4:
        array = np.mean(array, axis=-1)
    if array.ndim != 3:
        return None
    if array.shape[0] <= 8 and array.shape[1] > array.shape[0]:
        array = np.transpose(array, (1, 0, 2))
    if array.ndim != 3:
        return None
    frames = array.reshape(array.shape[0], -1)
    norms = np.linalg.norm(frames, axis=1, keepdims=True)
    norms[norms < 1e-8] = 1.0
    return frames / norms


def _embedding_summary(
    embeddings: np.ndarray | None,
    fps: float | None,
    start_ms: int,
    end_ms: int,
) -> np.ndarray | None:
    if embeddings is None or not fps or fps <= 0 or embeddings.size == 0:
        return None
    lo = max(0, int(round(start_ms / 1000.0 * fps)))
    hi = min(embeddings.shape[0], int(round(end_ms / 1000.0 * fps)))
    if hi <= lo:
        return None
    summary = np.mean(embeddings[lo:hi], axis=0)
    norm = float(np.linalg.norm(summary))
    return summary / norm if norm > 1e-8 else summary


def _cosine(a: np.ndarray | None, b: np.ndarray | None) -> float:
    if a is None or b is None:
        return 0.0
    denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denominator <= 1e-9:
        return 0.0
    return _clip01(float(np.dot(a, b) / denominator))


def _allin1_structure(path: Path, duration_ms: int) -> tuple[dict[str, Any] | None, list[str]]:
    warnings: list[str] = []
    if allin1_infer is None:
        return None, ["all-in-one-infer could not be imported; semantic structure fell back to librosa."]
    try:
        result = allin1_infer.analyze(
            str(path),
            include_activations=True,
            include_embeddings=True,
        )
        beats_ms = [
            int(round(float(value) * 1000))
            for value in list(result.beats)
            if 0 <= float(value) * 1000 <= duration_ms
        ]
        downbeats_ms = sorted({
            int(round(float(value) * 1000))
            for value in list(result.downbeats)
            if 0 <= float(value) * 1000 <= duration_ms
        })
        beat_positions = [int(value) for value in list(getattr(result, "beat_positions", []))]
        activations = getattr(result, "activations", None) or {}
        activation_fps = float(getattr(result, "activation_fps", 0) or 0) or None
        segment_activ = np.asarray(activations.get("segment"), dtype=float) if activations.get("segment") is not None else None
        beat_activ = np.asarray(activations.get("beat"), dtype=float) if activations.get("beat") is not None else None
        downbeat_activ = np.asarray(activations.get("downbeat"), dtype=float) if activations.get("downbeat") is not None else None
        label_activ = np.asarray(activations.get("label"), dtype=float) if activations.get("label") is not None else None

        sections: list[dict[str, Any]] = []
        for index, segment in enumerate(list(result.segments)):
            start_ms = max(0, min(duration_ms, int(round(float(segment.start) * 1000))))
            end_ms = max(start_ms + 1, min(duration_ms, int(round(float(segment.end) * 1000))))
            raw_label = str(segment.label or "section").strip().lower()
            section_type = raw_label if raw_label in SEMANTIC_TYPES else "section"
            label = raw_label.replace("_", " ").title() if raw_label else f"Section {index + 1}"
            label_conf = _label_confidence(label_activ, activation_fps, raw_label, start_ms, end_ms)
            boundary_conf = _activation_at(segment_activ, activation_fps, start_ms)
            confidence_values = [item for item in (label_conf, boundary_conf) if item is not None]
            confidence = float(np.mean(confidence_values)) if confidence_values else None
            sections.append({
                "id": f"section-{index + 1}",
                "label": label,
                "type": section_type,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "energy": 0.5,
                "confidence": round(confidence, 3) if confidence is not None else None,
                "label_confidence": round(label_conf, 3) if label_conf is not None else None,
                "boundary_confidence": round(boundary_conf, 3) if boundary_conf is not None else None,
            })
        bpm_value = float(result.bpm) if getattr(result, "bpm", None) is not None else None
        beat_conf_values = [
            item for item in (_activation_at(beat_activ, activation_fps, ms, 80) for ms in beats_ms)
            if item is not None
        ]
        downbeat_conf_values = [
            item for item in (_activation_at(downbeat_activ, activation_fps, ms, 100) for ms in downbeats_ms)
            if item is not None
        ]
        return {
            "bpm": round(bpm_value, 2) if bpm_value and np.isfinite(bpm_value) else None,
            "beats_ms": beats_ms,
            "beat_positions": beat_positions,
            "downbeats_ms": downbeats_ms,
            "downbeat_source": "model" if downbeats_ms else "none",
            "sections": sections,
            "engine": "all-in-one-infer",
            "model": "harmonix-all",
            "semantic_structure": True,
            "activation_fps": activation_fps,
            "embeddings": _prepare_embeddings(getattr(result, "embeddings", None)),
            "beat_model_confidence": float(np.mean(beat_conf_values)) if beat_conf_values else None,
            "downbeat_model_confidence": float(np.mean(downbeat_conf_values)) if downbeat_conf_values else None,
        }, warnings
    except Exception as exc:
        warnings.append(f"all-in-one-infer failed and librosa fallback was used: {str(exc)[:280]}")
        return None, warnings


def _fallback_structure(
    duration_ms: int,
    y: np.ndarray,
    sr: int,
    hop: int,
    onset: np.ndarray,
) -> dict[str, Any]:
    tempo_raw, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset,
        sr=sr,
        hop_length=hop,
        trim=False,
    )
    tempo_values = np.asarray(tempo_raw).reshape(-1)
    bpm = float(tempo_values[0]) if tempo_values.size and np.isfinite(tempo_values[0]) else None
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)
    beats_ms = [int(round(value * 1000)) for value in beat_times if value * 1000 <= duration_ms]

    target_sections = int(np.clip(round((duration_ms / 1000) / 32), 4, 9))
    try:
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
        raw_boundaries = librosa.segment.agglomerative(chroma, k=target_sections)
        boundary_seconds = librosa.frames_to_time(raw_boundaries, sr=sr, hop_length=hop)
        boundaries = sorted({0, *[int(round(value * 1000)) for value in boundary_seconds], duration_ms})
    except Exception:
        boundaries = [int(round(duration_ms * index / target_sections)) for index in range(target_sections + 1)]
    boundaries = [value for value in boundaries if 0 <= value <= duration_ms]
    if not boundaries or boundaries[0] != 0:
        boundaries.insert(0, 0)
    if boundaries[-1] != duration_ms:
        boundaries.append(duration_ms)

    sections = [
        {
            "id": f"section-{index + 1}",
            "label": "Intro" if index == 0 else "Outro" if index == len(boundaries) - 2 else f"Section {index + 1}",
            "type": "intro" if index == 0 else "outro" if index == len(boundaries) - 2 else "section",
            "start_ms": start,
            "end_ms": end,
            "energy": 0.5,
            "confidence": 0.35,
            "label_confidence": None,
            "boundary_confidence": 0.35,
        }
        for index, (start, end) in enumerate(zip(boundaries[:-1], boundaries[1:]))
    ]
    inferred_downbeats = beats_ms[::4]
    return {
        "bpm": round(bpm, 2) if bpm else None,
        "beats_ms": beats_ms,
        "beat_positions": [],
        "downbeats_ms": inferred_downbeats,
        "downbeat_source": "inferred_from_beats" if inferred_downbeats else "none",
        "sections": sections,
        "engine": "librosa-fallback",
        "model": None,
        "semantic_structure": False,
        "activation_fps": None,
        "embeddings": None,
        "beat_model_confidence": None,
        "downbeat_model_confidence": None,
    }


def _chroma_summary(chroma: np.ndarray, chroma_times_ms: np.ndarray, start_ms: int, end_ms: int) -> np.ndarray:
    mask = (chroma_times_ms >= start_ms) & (chroma_times_ms < end_ms)
    if not np.any(mask):
        return np.zeros(12, dtype=float)
    summary = np.mean(chroma[:, mask], axis=1)
    norm = np.linalg.norm(summary)
    return summary / norm if norm > 1e-9 else summary


def _structure_score(section_type: str) -> float:
    return {
        "chorus": 1.0,
        "solo": 0.92,
        "inst": 0.90,
        "bridge": 0.76,
        "verse": 0.68,
        "break": 0.58,
        "section": 0.62,
        "intro": 0.32,
        "outro": 0.28,
    }.get(section_type, 0.6)


def _bars_and_phrases(
    duration_ms: int,
    downbeats_ms: list[int],
    sections: list[dict[str, Any]],
    downbeat_source: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not downbeats_ms:
        return [], []
    points = sorted(set([0, *downbeats_ms, duration_ms]))
    bars: list[dict[str, Any]] = []
    for start, end in zip(points[:-1], points[1:]):
        if end - start < 100:
            continue
        section = next((item for item in sections if int(item["start_ms"]) <= start < int(item["end_ms"])), None)
        bars.append({
            "index": len(bars) + 1,
            "start_ms": start,
            "end_ms": end,
            "section_id": section.get("id") if section else None,
            "confidence": 0.95 if downbeat_source == "model" else 0.55,
            "provenance": downbeat_source,
        })

    phrases: list[dict[str, Any]] = []
    for section in sections:
        section_bars = [bar for bar in bars if int(section["start_ms"]) <= bar["start_ms"] < int(section["end_ms"])]
        if not section_bars:
            phrases.append({
                "id": f"phrase-{len(phrases) + 1}",
                "start_ms": int(section["start_ms"]),
                "end_ms": int(section["end_ms"]),
                "section_id": section["id"],
                "bar_start": None,
                "bar_end": None,
                "confidence": round(float(section.get("confidence") or 0.45), 3),
                "provenance": "semantic_section" if section.get("type") != "section" else "section_boundary",
            })
            continue
        for offset in range(0, len(section_bars), 4):
            group = section_bars[offset:offset + 4]
            phrases.append({
                "id": f"phrase-{len(phrases) + 1}",
                "start_ms": group[0]["start_ms"],
                "end_ms": group[-1]["end_ms"],
                "section_id": section["id"],
                "bar_start": group[0]["index"],
                "bar_end": group[-1]["index"],
                "confidence": round(min(float(section.get("confidence") or 0.55), float(np.mean([bar["confidence"] for bar in group]))), 3),
                "provenance": "semantic_section_4bar" if section.get("type") != "section" else "inferred_4bar",
            })
    return bars, phrases


def _candidate_intent_scores(metrics: dict[str, float]) -> dict[str, float]:
    m = metrics
    scores = {
        "instant_hook": (
            0.24 * m["energy_lift"] + 0.18 * m["onset_density"] + 0.16 * m["semantic_recurrence"] +
            0.14 * m["structure"] + 0.11 * m["boundary_fit"] + 0.09 * m["harmonic_distinctiveness"] +
            0.08 * m["segment_confidence"]
        ),
        "musical_identity": (
            0.29 * m["semantic_recurrence"] + 0.17 * m["harmonic_recurrence"] + 0.18 * m["structure"] +
            0.14 * m["harmonic_distinctiveness"] + 0.09 * m["energy"] + 0.08 * m["segment_confidence"] +
            0.05 * m["boundary_fit"]
        ),
        "groove_loop": (
            0.27 * m["boundary_loop_fit"] + 0.19 * m["onset_density"] + 0.16 * m["groove_stability"] +
            0.14 * m["boundary_fit"] + 0.11 * m["semantic_recurrence"] + 0.08 * m["energy"] +
            0.05 * m["structure"]
        ),
        "build_drop": (
            0.31 * m["energy_lift"] + 0.24 * m["arc_strength"] + 0.16 * m["novelty"] +
            0.10 * m["boundary_fit"] + 0.09 * m["onset_density"] + 0.06 * m["segment_confidence"] +
            0.04 * m["structure"]
        ),
        "climax": (
            0.31 * m["energy"] + 0.18 * m["onset_density"] + 0.16 * m["structure"] +
            0.13 * m["semantic_recurrence"] + 0.13 * m["energy_lift"] + 0.09 * m["segment_confidence"]
        ),
        "story_arc": (
            0.24 * m["arc_strength"] + 0.19 * m["structure"] + 0.14 * m["semantic_recurrence"] +
            0.13 * m["novelty"] + 0.11 * m["energy_lift"] + 0.09 * m["boundary_fit"] +
            0.06 * m["harmonic_distinctiveness"] + 0.04 * m["boundary_loop_fit"]
        ),
    }
    return {key: round(_clip01(value), 4) for key, value in scores.items()}


def _dominant_intent(scores: dict[str, float]) -> str:
    return max(scores, key=scores.get) if scores else "instant_hook"


def _build_hook_candidates(
    *,
    duration_ms: int,
    sections: list[dict[str, Any]],
    downbeats_ms: list[int],
    downbeat_source: str,
    rms: np.ndarray,
    rms_times_ms: np.ndarray,
    onset: np.ndarray,
    onset_times_ms: np.ndarray,
    chroma: np.ndarray,
    chroma_times_ms: np.ndarray,
    embeddings: np.ndarray | None,
    embedding_fps: float | None,
) -> list[dict[str, Any]]:
    starts = set(downbeats_ms)
    starts.update(int(section["start_ms"]) for section in sections)
    if not starts:
        starts.update(range(0, duration_ms, 4000))

    harmonic_cache: dict[tuple[int, int], np.ndarray] = {}
    semantic_cache: dict[tuple[int, int], np.ndarray | None] = {}
    raw: list[dict[str, Any]] = []
    for target_ms in SOCIAL_DURATIONS_MS:
        for rough_start in sorted(starts):
            start_ms = _nearest(rough_start, downbeats_ms, duration_ms)
            if start_ms + min(4500, target_ms) >= duration_ms:
                continue
            rough_end = min(duration_ms, start_ms + target_ms)
            end_ms = _nearest(rough_end, downbeats_ms, duration_ms) if downbeats_ms else rough_end
            if end_ms <= start_ms + 3000:
                end_ms = _next_point(rough_end, downbeats_ms, duration_ms)
            if end_ms <= start_ms + 3000:
                end_ms = min(duration_ms, start_ms + target_ms)
            actual_duration = end_ms - start_ms
            if actual_duration < 3500 or actual_duration > target_ms * 1.5:
                continue

            section = next(
                (item for item in sections if int(item["start_ms"]) <= start_ms < int(item["end_ms"])),
                sections[0] if sections else {"type": "section", "label": "Section", "confidence": 0.4},
            )
            section_type = str(section.get("type") or "section")
            energy = _mean_between(rms, rms_times_ms, start_ms, end_ms)
            previous_start = max(0, start_ms - min(8000, actual_duration))
            previous_energy = _mean_between(rms, rms_times_ms, previous_start, start_ms, default=energy)
            next_energy = _mean_between(rms, rms_times_ms, end_ms, min(duration_ms, end_ms + min(8000, actual_duration)), default=energy)
            energy_lift = _clip01(0.5 + (energy - previous_energy) * 0.9)
            onset_density = _mean_between(onset, onset_times_ms, start_ms, end_ms)
            onset_mask = (onset_times_ms >= start_ms) & (onset_times_ms < end_ms)
            onset_std = float(np.std(onset[onset_mask])) if np.any(onset_mask) else 0.5
            groove_stability = _clip01(1.0 - onset_std)

            harmonic_fp = _chroma_summary(chroma, chroma_times_ms, start_ms, end_ms)
            harmonic_cache[(start_ms, end_ms)] = harmonic_fp
            semantic_fp = _embedding_summary(embeddings, embedding_fps, start_ms, end_ms)
            semantic_cache[(start_ms, end_ms)] = semantic_fp

            pre_harmonic = _chroma_summary(chroma, chroma_times_ms, max(0, start_ms - 4000), start_ms)
            pre_semantic = _embedding_summary(embeddings, embedding_fps, max(0, start_ms - 4000), start_ms)
            semantic_novelty = 1.0 - _cosine(pre_semantic, semantic_fp) if semantic_fp is not None and pre_semantic is not None else 0.0
            harmonic_novelty = 1.0 - _cosine(pre_harmonic, harmonic_fp)
            novelty = _clip01(0.65 * semantic_novelty + 0.35 * harmonic_novelty) if semantic_fp is not None else _clip01(harmonic_novelty)

            chroma_mask = (chroma_times_ms >= start_ms) & (chroma_times_ms < end_ms)
            chroma_var = float(np.mean(np.std(chroma[:, chroma_mask], axis=1))) if np.any(chroma_mask) else 0.0
            harmonic_distinctiveness = _clip01(chroma_var * 4.0)

            edge = min(1800, max(700, actual_duration // 5))
            start_h = _chroma_summary(chroma, chroma_times_ms, start_ms, min(end_ms, start_ms + edge))
            end_h = _chroma_summary(chroma, chroma_times_ms, max(start_ms, end_ms - edge), end_ms)
            start_s = _embedding_summary(embeddings, embedding_fps, start_ms, min(end_ms, start_ms + edge))
            end_s = _embedding_summary(embeddings, embedding_fps, max(start_ms, end_ms - edge), end_ms)
            harmonic_edge_fit = _cosine(start_h, end_h)
            semantic_edge_fit = _cosine(start_s, end_s) if start_s is not None and end_s is not None else harmonic_edge_fit
            energy_edge_fit = 1.0 - abs(
                _mean_between(rms, rms_times_ms, start_ms, min(end_ms, start_ms + 1500)) -
                _mean_between(rms, rms_times_ms, max(start_ms, end_ms - 1500), end_ms)
            )
            boundary_loop_fit = _clip01(0.45 * semantic_edge_fit + 0.35 * harmonic_edge_fit + 0.20 * energy_edge_fit)

            if downbeat_source == "model":
                boundary_fit = 1.0 if start_ms in downbeats_ms and end_ms in downbeats_ms else 0.78 if start_ms in downbeats_ms else 0.55
            elif downbeat_source == "inferred_from_beats":
                boundary_fit = 0.72 if start_ms in downbeats_ms and end_ms in downbeats_ms else 0.58 if start_ms in downbeats_ms else 0.45
            else:
                boundary_fit = 0.4

            midpoint = start_ms + actual_duration // 2
            first_energy = _mean_between(rms, rms_times_ms, start_ms, midpoint, default=energy)
            second_energy = _mean_between(rms, rms_times_ms, midpoint, end_ms, default=energy)
            internal_growth = _clip01(0.5 + (second_energy - first_energy))
            context_contrast = _clip01(0.5 + max(energy - previous_energy, energy - next_energy))
            arc_strength = _clip01(0.55 * internal_growth + 0.45 * context_contrast)

            raw.append({
                "start_ms": start_ms,
                "end_ms": end_ms,
                "duration_ms": actual_duration,
                "target_duration_ms": target_ms,
                "section_type": section_type,
                "section_label": str(section.get("label") or "Section"),
                "metrics": {
                    "energy": _clip01(energy),
                    "energy_lift": energy_lift,
                    "novelty": novelty,
                    "onset_density": _clip01(onset_density),
                    "groove_stability": groove_stability,
                    "harmonic_distinctiveness": harmonic_distinctiveness,
                    "boundary_fit": boundary_fit,
                    "boundary_loop_fit": boundary_loop_fit,
                    "structure": _structure_score(section_type),
                    "segment_confidence": _clip01(float(section.get("confidence") or (0.68 if section_type != "section" else 0.45))),
                    "harmonic_recurrence": 0.0,
                    "semantic_recurrence": 0.0,
                    "arc_strength": arc_strength,
                },
            })

    for candidate in raw:
        key = (candidate["start_ms"], candidate["end_ms"])
        h_fp = harmonic_cache[key]
        s_fp = semantic_cache[key]
        harmonic_similarities: list[float] = []
        semantic_similarities: list[float] = []
        for other in raw:
            if other is candidate or abs(other["duration_ms"] - candidate["duration_ms"]) > 2500:
                continue
            overlap = max(0, min(candidate["end_ms"], other["end_ms"]) - max(candidate["start_ms"], other["start_ms"]))
            if overlap > candidate["duration_ms"] * 0.25:
                continue
            other_key = (other["start_ms"], other["end_ms"])
            harmonic_similarities.append(_cosine(h_fp, harmonic_cache[other_key]))
            if s_fp is not None and semantic_cache[other_key] is not None:
                semantic_similarities.append(_cosine(s_fp, semantic_cache[other_key]))
        m = candidate["metrics"]
        m["harmonic_recurrence"] = max(harmonic_similarities, default=0.35)
        m["semantic_recurrence"] = max(semantic_similarities, default=m["harmonic_recurrence"])
        m["repetition"] = m["semantic_recurrence"]
        m["melodic_salience"] = m["harmonic_distinctiveness"]
        m["loopability"] = m["boundary_loop_fit"]

        intent_scores = _candidate_intent_scores(m)
        candidate["intent_scores"] = intent_scores
        candidate["kind"] = _dominant_intent(intent_scores)
        candidate["score"] = round(
            _clip01(
                0.26 * intent_scores["musical_identity"] +
                0.22 * intent_scores["instant_hook"] +
                0.16 * intent_scores["groove_loop"] +
                0.14 * intent_scores["build_drop"] +
                0.12 * intent_scores["climax"] +
                0.10 * intent_scores["story_arc"]
            ),
            4,
        )
        reasons: list[str] = []
        if m["semantic_recurrence"] >= 0.75:
            reasons.append("The same higher-level musical idea recurs elsewhere in the track.")
        if m["structure"] >= 0.88:
            reasons.append(f"Strong structural position: {candidate['section_label']}.")
        if m["energy_lift"] >= 0.68:
            reasons.append("Clear energy lift into this moment.")
        if m["onset_density"] >= 0.68:
            reasons.append("Rhythmically active, edit-friendly groove.")
        if m["harmonic_distinctiveness"] >= 0.62:
            reasons.append("Distinct harmonic motion gives the window a recognizable identity.")
        if m["boundary_loop_fit"] >= 0.72:
            reasons.append("The start/end musical state is compatible with a short-form loop.")
        if m["boundary_fit"] >= 0.9:
            reasons.append("The window is aligned to verified downbeats.")
        if m["arc_strength"] >= 0.7:
            reasons.append("The window contains a meaningful internal rise/payoff arc.")
        candidate["reasons"] = reasons[:4] or ["Balanced musical, structural and editorial fit."]

    raw.sort(key=lambda item: (-item["score"], item["start_ms"], item["duration_ms"]))
    selected: list[dict[str, Any]] = []
    for candidate in raw:
        if any(
            abs(candidate["start_ms"] - existing["start_ms"]) < 1800
            and abs(candidate["duration_ms"] - existing["duration_ms"]) < 3000
            for existing in selected
        ):
            continue
        result = dict(candidate)
        result["id"] = f"hook-{len(selected) + 1}"
        result["label"] = f"{result['kind'].replace('_', ' ').title()} · {result['section_label']}"
        selected.append(result)
        if len(selected) >= 20:
            break
    return selected


def _moment_rankings(candidates: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for intent in MOMENT_INTENTS:
        ranked = sorted(
            candidates,
            key=lambda item: (-float(item.get("intent_scores", {}).get(intent, 0)), -float(item.get("score", 0)), int(item["start_ms"])),
        )
        chosen: list[dict[str, Any]] = []
        for candidate in ranked:
            if any(abs(int(candidate["start_ms"]) - int(existing["start_ms"])) < 2500 for existing in chosen):
                continue
            chosen.append(candidate)
            if len(chosen) >= 3:
                break
        result[intent] = [
            {
                "candidate_id": candidate["id"],
                "start_ms": candidate["start_ms"],
                "end_ms": candidate["end_ms"],
                "score": round(float(candidate["intent_scores"][intent]), 4),
                "label": candidate["label"],
            }
            for candidate in chosen
        ]
    return result


def _duration_score(candidate: dict[str, Any], duration_ms: int) -> float:
    return _clip01(1.0 - abs(int(candidate["duration_ms"]) - duration_ms) / max(duration_ms, 1))


def _social_objective(candidate: dict[str, Any], duration_ms: int) -> float:
    scores = candidate.get("intent_scores", {})
    duration_fit = _duration_score(candidate, duration_ms)
    loop = float(candidate["metrics"].get("boundary_loop_fit", 0))
    if duration_ms <= 6000:
        value = 0.50 * scores.get("instant_hook", 0) + 0.20 * scores.get("groove_loop", 0) + 0.20 * loop + 0.10 * duration_fit
    elif duration_ms <= 8000:
        value = 0.38 * scores.get("instant_hook", 0) + 0.24 * scores.get("musical_identity", 0) + 0.18 * scores.get("groove_loop", 0) + 0.10 * loop + 0.10 * duration_fit
    elif duration_ms <= 15000:
        value = 0.31 * scores.get("musical_identity", 0) + 0.20 * scores.get("instant_hook", 0) + 0.15 * scores.get("build_drop", 0) + 0.13 * scores.get("climax", 0) + 0.11 * scores.get("story_arc", 0) + 0.10 * duration_fit
    else:
        value = 0.40 * scores.get("story_arc", 0) + 0.20 * scores.get("musical_identity", 0) + 0.14 * scores.get("build_drop", 0) + 0.11 * scores.get("climax", 0) + 0.05 * loop + 0.10 * duration_fit
    return _clip01(value)


def _social_cuts(candidates: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any] | None], dict[str, list[dict[str, Any]]]]:
    primary: dict[str, dict[str, Any] | None] = {}
    options: dict[str, list[dict[str, Any]]] = {}
    for duration_ms in SOCIAL_DURATIONS_MS:
        ranked = sorted(
            candidates,
            key=lambda item: (-_social_objective(item, duration_ms), -_duration_score(item, duration_ms), int(item["start_ms"])),
        )
        chosen: list[dict[str, Any]] = []
        for candidate in ranked:
            if _duration_score(candidate, duration_ms) < 0.45:
                continue
            if any(abs(int(candidate["start_ms"]) - int(existing["start_ms"])) < 2200 for existing in chosen):
                continue
            chosen.append(candidate)
            if len(chosen) >= 3:
                break
        key = str(duration_ms // 1000)
        options[key] = [
            {
                "candidate_id": candidate["id"],
                "start_ms": candidate["start_ms"],
                "end_ms": candidate["end_ms"],
                "score": round(_social_objective(candidate, duration_ms), 4),
                "hook_score": candidate["score"],
                "kind": candidate["kind"],
                "label": candidate["label"],
                "intent_scores": candidate.get("intent_scores", {}),
            }
            for candidate in chosen
        ]
        primary[key] = options[key][0] if options[key] else None
    return primary, options


def _master_qc(path: Path) -> dict[str, Any]:
    try:
        audio, sr = sf.read(str(path), always_2d=True, dtype="float32")
    except Exception as exc:
        return {
            "technical_ready": False,
            "issues": [{"severity": "critical", "code": "decode_failed", "message": f"QC could not decode the standardized master: {str(exc)[:180]}"}],
        }
    if audio.size == 0:
        return {
            "technical_ready": False,
            "issues": [{"severity": "critical", "code": "empty_audio", "message": "The decoded master contains no audio samples."}],
        }

    peak = float(np.max(np.abs(audio)))
    rms_value = float(np.sqrt(np.mean(np.square(audio))))
    sample_peak_dbfs = _db(peak)
    rms_dbfs = _db(rms_value)
    crest_factor_db = sample_peak_dbfs - rms_dbfs
    clipping_samples = int(np.sum(np.abs(audio) >= 0.999))
    clipping_ratio = clipping_samples / max(audio.size, 1)
    dc_offset = float(np.max(np.abs(np.mean(audio, axis=0))))

    true_peak = peak
    try:
        oversampled = np.stack([
            librosa.resample(audio[:, channel], orig_sr=sr, target_sr=sr * 4, res_type="soxr_hq")
            for channel in range(audio.shape[1])
        ], axis=1)
        true_peak = float(np.max(np.abs(oversampled)))
    except Exception:
        pass
    true_peak_dbtp = _db(true_peak)

    integrated_lufs: float | None = None
    if pyln is not None:
        try:
            meter = pyln.Meter(sr)
            integrated_lufs = float(meter.integrated_loudness(audio))
            if not np.isfinite(integrated_lufs):
                integrated_lufs = None
        except Exception:
            integrated_lufs = None

    stereo_correlation: float | None = None
    if audio.shape[1] >= 2:
        left, right = audio[:, 0], audio[:, 1]
        if float(np.std(left)) > 1e-8 and float(np.std(right)) > 1e-8:
            stereo_correlation = float(np.corrcoef(left, right)[0, 1])

    sample_energy = np.max(np.abs(audio), axis=1)
    active = np.flatnonzero(sample_energy > 10 ** (-60 / 20))
    leading_silence_ms = int(round((active[0] / sr) * 1000)) if active.size else int(round(len(audio) / sr * 1000))
    trailing_silence_ms = int(round(((len(audio) - 1 - active[-1]) / sr) * 1000)) if active.size else int(round(len(audio) / sr * 1000))

    issues: list[dict[str, str]] = []
    if clipping_samples > 0:
        issues.append({"severity": "critical", "code": "clipping", "message": f"Detected {clipping_samples} samples at or above 0.999 FS."})
    if true_peak_dbtp > -0.3:
        issues.append({"severity": "warning", "code": "true_peak_hot", "message": f"Estimated true peak is {true_peak_dbtp:.2f} dBTP; this leaves very little codec headroom."})
    if integrated_lufs is not None and integrated_lufs > -6.0:
        issues.append({"severity": "warning", "code": "very_loud", "message": f"Integrated loudness is {integrated_lufs:.1f} LUFS, unusually hot for a distribution master."})
    if integrated_lufs is not None and integrated_lufs < -20.0:
        issues.append({"severity": "warning", "code": "very_quiet", "message": f"Integrated loudness is {integrated_lufs:.1f} LUFS, unusually quiet for a contemporary master."})
    if stereo_correlation is not None and stereo_correlation < -0.25:
        issues.append({"severity": "warning", "code": "phase_risk", "message": f"Stereo correlation is {stereo_correlation:.2f}; check mono compatibility."})
    if leading_silence_ms > 1500:
        issues.append({"severity": "warning", "code": "leading_silence", "message": f"Leading silence is {leading_silence_ms / 1000:.1f}s."})
    if trailing_silence_ms > 5000:
        issues.append({"severity": "warning", "code": "trailing_silence", "message": f"Trailing silence is {trailing_silence_ms / 1000:.1f}s."})
    if dc_offset > 0.01:
        issues.append({"severity": "warning", "code": "dc_offset", "message": f"DC offset reaches {dc_offset:.4f}; inspect the master chain."})

    critical = any(issue["severity"] == "critical" for issue in issues)
    return {
        "technical_ready": not critical,
        "integrated_lufs": round(integrated_lufs, 2) if integrated_lufs is not None else None,
        "sample_peak_dbfs": round(sample_peak_dbfs, 3),
        "true_peak_dbtp": round(true_peak_dbtp, 3),
        "rms_dbfs": round(rms_dbfs, 3),
        "crest_factor_db": round(crest_factor_db, 3),
        "clipping_samples": clipping_samples,
        "clipping_ratio": round(clipping_ratio, 8),
        "stereo_correlation": round(stereo_correlation, 4) if stereo_correlation is not None else None,
        "dc_offset": round(dc_offset, 6),
        "leading_silence_ms": leading_silence_ms,
        "trailing_silence_ms": trailing_silence_ms,
        "sample_rate_hz": int(sr),
        "channels": int(audio.shape[1]),
        "analysis_note": "QC measurements are calculated from Atlas's lossless 44.1 kHz PCM analysis decode; true peak is a 4x oversampled estimate.",
        "issues": issues,
    }


def analyze_music(path: Path, source_audio: dict[str, Any] | None = None) -> dict[str, Any]:
    y, sr = librosa.load(path, sr=22050, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))
    duration_ms = max(1, int(round(duration * 1000)))
    hop = 512

    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    onset_norm = _normalized(onset)
    onset_times_ms = librosa.frames_to_time(np.arange(len(onset_norm)), sr=sr, hop_length=hop) * 1000
    rms = _normalized(librosa.feature.rms(y=y, hop_length=hop)[0])
    rms_times_ms = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop) * 1000
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
    chroma_times_ms = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=hop) * 1000

    structure, warnings = _allin1_structure(path, duration_ms)
    if structure is None:
        structure = _fallback_structure(duration_ms, y, sr, hop, onset)
    sections = structure["sections"]
    _section_energy(sections, rms, rms_times_ms)

    beats_ms = list(structure["beats_ms"])
    downbeats_ms = sorted(set(int(item) for item in structure["downbeats_ms"] if 0 <= int(item) <= duration_ms))
    downbeat_source = str(structure.get("downbeat_source") or "none")
    if not downbeats_ms and beats_ms:
        downbeats_ms = beats_ms[::4]
        downbeat_source = "inferred_from_beats"
        warnings.append("No model downbeats were returned; every fourth beat is exposed only as an inferred editing grid.")

    bars, phrases = _bars_and_phrases(duration_ms, downbeats_ms, sections, downbeat_source)

    sample_step = max(1, int(round(len(rms) / 120)))
    energy_curve = [
        {"ms": int(round(rms_times_ms[index])), "value": round(float(rms[index]), 4)}
        for index in range(0, len(rms), sample_step)
        if rms_times_ms[index] <= duration_ms
    ]
    if not energy_curve or energy_curve[-1]["ms"] < duration_ms:
        energy_curve.append({"ms": duration_ms, "value": round(float(rms[-1]) if rms.size else 0.5, 4)})

    def onset_at(ms: int) -> float:
        frame_index = int(librosa.time_to_frames(ms / 1000, sr=sr, hop_length=hop))
        lo, hi = max(0, frame_index - 3), min(len(onset_norm), frame_index + 4)
        return float(np.max(onset_norm[lo:hi])) if hi > lo else 0.25

    edit_points = []
    for section in sections[1:]:
        section_conf = float(section.get("boundary_confidence") or section.get("confidence") or 0.45)
        confidence = _clip01(0.45 * section_conf + 0.55 * onset_at(int(section["start_ms"])))
        edit_points.append({
            "ms": int(section["start_ms"]),
            "confidence": round(confidence, 3),
            "reason": f"Structural transition into {str(section['label']).lower()}.",
            "provenance": "semantic_model" if structure["semantic_structure"] else "audio_segmentation_fallback",
        })

    peak_candidates = np.argsort(rms)[::-1] if rms.size else []
    peaks_ms: list[int] = []
    for index in peak_candidates:
        ms = int(round(rms_times_ms[int(index)]))
        if all(abs(ms - existing) >= 8000 for existing in peaks_ms):
            peaks_ms.append(ms)
        if len(peaks_ms) >= 6:
            break
    peaks_ms.sort()

    beat_confidence = structure.get("beat_model_confidence")
    if beat_confidence is None:
        beat_confidence = 0.0
        if beats_ms and onset_norm.size:
            frames = librosa.time_to_frames(np.asarray(beats_ms) / 1000, sr=sr, hop_length=hop)
            frames = np.clip(frames, 0, len(onset_norm) - 1)
            beat_confidence = float(np.mean(onset_norm[frames])) if len(frames) else 0.0
    downbeat_confidence = structure.get("downbeat_model_confidence")
    if downbeat_confidence is None:
        downbeat_confidence = 0.9 * float(beat_confidence) if downbeat_source == "model" else 0.52 * float(beat_confidence) if downbeat_source == "inferred_from_beats" else 0.0
    section_confidences = [float(section["confidence"]) for section in sections if isinstance(section.get("confidence"), (int, float))]
    structure_confidence = float(np.mean(section_confidences)) if section_confidences else (0.72 if structure["semantic_structure"] else 0.38)

    candidates = _build_hook_candidates(
        duration_ms=duration_ms,
        sections=sections,
        downbeats_ms=downbeats_ms,
        downbeat_source=downbeat_source,
        rms=rms,
        rms_times_ms=rms_times_ms,
        onset=onset_norm,
        onset_times_ms=onset_times_ms,
        chroma=chroma,
        chroma_times_ms=chroma_times_ms,
        embeddings=structure.get("embeddings"),
        embedding_fps=structure.get("activation_fps"),
    )
    social_cuts, social_options = _social_cuts(candidates)
    moments = _moment_rankings(candidates)
    top_scores = [float(candidate["score"]) for candidate in candidates[:5]]
    hook_confidence = _clip01(
        0.40 * (float(np.mean(top_scores)) if top_scores else 0.0) +
        0.25 * structure_confidence +
        0.20 * float(beat_confidence) +
        0.15 * (1.0 if structure.get("embeddings") is not None else 0.45)
    )
    overall_confidence = _clip01(
        0.31 * float(beat_confidence) + 0.24 * float(downbeat_confidence) + 0.25 * structure_confidence + 0.20 * hook_confidence
    )

    analysis_source = dict(source_audio or {})
    analysis_source.setdefault("analysis_config", ANALYSIS_CONFIG)

    return {
        "version": ANALYSIS_VERSION,
        "duration_ms": duration_ms,
        "bpm": structure["bpm"],
        "beat_confidence": round(_clip01(float(beat_confidence)), 3),
        "beats_ms": beats_ms,
        "beat_positions": structure.get("beat_positions", []),
        "downbeats_ms": downbeats_ms,
        "downbeat_source": downbeat_source,
        "bars": bars,
        "phrases": phrases,
        "sections": sections,
        "energy_curve": energy_curve,
        "edit_points": edit_points,
        "peaks_ms": peaks_ms,
        "hook_candidates": candidates,
        "moments": moments,
        "social_cuts": social_cuts,
        "social_cut_options": social_options,
        "master_qc": _master_qc(path),
        "analysis": {
            "engine": structure["engine"],
            "model": structure["model"],
            "quality": "full" if structure["semantic_structure"] else "fallback",
            "semantic_structure": bool(structure["semantic_structure"]),
            "real_downbeats": downbeat_source == "model",
            "downbeat_source": downbeat_source,
            "embeddings_used": structure.get("embeddings") is not None,
            "activation_fps": structure.get("activation_fps"),
            "config": ANALYSIS_CONFIG,
            "confidence": {
                "overall": round(overall_confidence, 3),
                "rhythm": round(_clip01(float(beat_confidence)), 3),
                "downbeats": round(_clip01(float(downbeat_confidence)), 3),
                "structure": round(_clip01(structure_confidence), 3),
                "hooks": round(hook_confidence, 3),
            },
            "warnings": warnings,
        },
        "source_audio": analysis_source,
        "source": "worker",
    }
