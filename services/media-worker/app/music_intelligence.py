from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import librosa
import numpy as np

try:
    import allin1_infer
except Exception:  # pragma: no cover - deployment fallback is intentional
    allin1_infer = None


SOCIAL_DURATIONS_MS = (6000, 8000, 15000, 30000)
HOOK_KINDS = ("instant_impact", "groove", "melodic", "climax", "build_and_drop")
SEMANTIC_TYPES = {"intro", "outro", "break", "bridge", "inst", "solo", "verse", "chorus"}


def _normalized(values: np.ndarray) -> np.ndarray:
    if values.size == 0:
        return values.astype(float)
    low, high = float(np.min(values)), float(np.max(values))
    if math.isclose(high, low):
        return np.full_like(values, 0.5, dtype=float)
    return (values.astype(float) - low) / (high - low)


def _clip01(value: float) -> float:
    return float(np.clip(value, 0.0, 1.0))


def _mean_between(values: np.ndarray, times_ms: np.ndarray, start_ms: int, end_ms: int, default: float = 0.5) -> float:
    mask = (times_ms >= start_ms) & (times_ms < end_ms)
    local = values[mask]
    return float(np.mean(local)) if local.size else default


def _nearest_downbeat(value_ms: int, downbeats_ms: list[int], duration_ms: int) -> int:
    if not downbeats_ms:
        return max(0, min(duration_ms, value_ms))
    return min(downbeats_ms, key=lambda item: abs(item - value_ms))


def _next_downbeat(value_ms: int, downbeats_ms: list[int], duration_ms: int) -> int:
    for item in downbeats_ms:
        if item >= value_ms:
            return item
    return duration_ms


def _previous_downbeat(value_ms: int, downbeats_ms: list[int]) -> int:
    previous = 0
    for item in downbeats_ms:
        if item > value_ms:
            break
        previous = item
    return previous


def _section_energy(sections: list[dict[str, Any]], rms: np.ndarray, rms_times_ms: np.ndarray) -> None:
    for section in sections:
        section["energy"] = round(
            _mean_between(rms, rms_times_ms, int(section["start_ms"]), int(section["end_ms"])),
            4,
        )


def _allin1_structure(path: Path, duration_ms: int) -> tuple[dict[str, Any] | None, list[str]]:
    warnings: list[str] = []
    if allin1_infer is None:
        return None, ["all-in-one-infer could not be imported; semantic structure fell back to librosa."]
    try:
        result = allin1_infer.analyze(str(path))
        beats_ms = [
            int(round(float(value) * 1000))
            for value in list(result.beats)
            if 0 <= float(value) * 1000 <= duration_ms
        ]
        downbeats_ms = [
            int(round(float(value) * 1000))
            for value in list(result.downbeats)
            if 0 <= float(value) * 1000 <= duration_ms
        ]
        beat_positions = [int(value) for value in list(getattr(result, "beat_positions", []))]
        sections: list[dict[str, Any]] = []
        for index, segment in enumerate(list(result.segments)):
            start_ms = max(0, min(duration_ms, int(round(float(segment.start) * 1000))))
            end_ms = max(start_ms + 1, min(duration_ms, int(round(float(segment.end) * 1000))))
            raw_label = str(segment.label or "section").strip().lower()
            section_type = raw_label if raw_label in SEMANTIC_TYPES else "section"
            label = raw_label.replace("_", " ").title() if raw_label else f"Section {index + 1}"
            sections.append({
                "id": f"section-{index + 1}",
                "label": label,
                "type": section_type,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "energy": 0.5,
                "confidence": None,
            })
        bpm_value = float(result.bpm) if getattr(result, "bpm", None) is not None else None
        return {
            "bpm": round(bpm_value, 2) if bpm_value and np.isfinite(bpm_value) else None,
            "beats_ms": beats_ms,
            "beat_positions": beat_positions,
            "downbeats_ms": sorted(set(downbeats_ms)),
            "sections": sections,
            "engine": "all-in-one-infer",
            "model": "harmonix-all",
            "semantic_structure": True,
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
            "confidence": None,
        }
        for index, (start, end) in enumerate(zip(boundaries[:-1], boundaries[1:]))
    ]
    # This is deliberately labelled inferred, not a real downbeat detector.
    inferred_downbeats = beats_ms[::4]
    return {
        "bpm": round(bpm, 2) if bpm else None,
        "beats_ms": beats_ms,
        "beat_positions": [],
        "downbeats_ms": inferred_downbeats,
        "sections": sections,
        "engine": "librosa-fallback",
        "model": None,
        "semantic_structure": False,
    }


def _chroma_summary(chroma: np.ndarray, chroma_times_ms: np.ndarray, start_ms: int, end_ms: int) -> np.ndarray:
    mask = (chroma_times_ms >= start_ms) & (chroma_times_ms < end_ms)
    if not np.any(mask):
        return np.zeros(12, dtype=float)
    summary = np.mean(chroma[:, mask], axis=1)
    norm = np.linalg.norm(summary)
    return summary / norm if norm > 1e-9 else summary


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denominator <= 1e-9:
        return 0.0
    return _clip01(float(np.dot(a, b) / denominator))


def _structure_score(section_type: str) -> float:
    return {
        "chorus": 1.0,
        "solo": 0.92,
        "inst": 0.9,
        "bridge": 0.76,
        "verse": 0.68,
        "break": 0.58,
        "section": 0.62,
        "intro": 0.32,
        "outro": 0.28,
    }.get(section_type, 0.6)


def _candidate_kind(metrics: dict[str, float], section_type: str) -> str:
    if metrics["energy_lift"] >= 0.72 and metrics["novelty"] >= 0.58:
        return "build_and_drop"
    if metrics["energy"] >= 0.82:
        return "climax"
    if metrics["melodic_salience"] >= metrics["onset_density"] and section_type in {"chorus", "solo", "inst"}:
        return "melodic"
    if metrics["onset_density"] >= 0.62:
        return "groove"
    return "instant_impact"


def _build_hook_candidates(
    *,
    duration_ms: int,
    sections: list[dict[str, Any]],
    downbeats_ms: list[int],
    rms: np.ndarray,
    rms_times_ms: np.ndarray,
    onset: np.ndarray,
    onset_times_ms: np.ndarray,
    chroma: np.ndarray,
    chroma_times_ms: np.ndarray,
) -> list[dict[str, Any]]:
    starts = set(downbeats_ms)
    starts.update(int(section["start_ms"]) for section in sections)
    if not starts:
        starts.update(range(0, duration_ms, 4000))

    chroma_cache: dict[tuple[int, int], np.ndarray] = {}
    raw: list[dict[str, Any]] = []
    for target_ms in SOCIAL_DURATIONS_MS:
        for rough_start in sorted(starts):
            start_ms = _nearest_downbeat(rough_start, downbeats_ms, duration_ms)
            if start_ms + min(4500, target_ms) >= duration_ms:
                continue
            rough_end = min(duration_ms, start_ms + target_ms)
            end_ms = _nearest_downbeat(rough_end, downbeats_ms, duration_ms) if downbeats_ms else rough_end
            if end_ms <= start_ms + 3000:
                end_ms = _next_downbeat(rough_end, downbeats_ms, duration_ms)
            if end_ms <= start_ms + 3000:
                end_ms = min(duration_ms, start_ms + target_ms)
            actual_duration = end_ms - start_ms
            if actual_duration < 3500 or actual_duration > target_ms * 1.5:
                continue

            section = next(
                (item for item in sections if int(item["start_ms"]) <= start_ms < int(item["end_ms"])),
                sections[0] if sections else {"type": "section", "label": "Section"},
            )
            section_type = str(section.get("type") or "section")
            energy = _mean_between(rms, rms_times_ms, start_ms, end_ms)
            previous_start = max(0, start_ms - min(8000, actual_duration))
            previous_energy = _mean_between(rms, rms_times_ms, previous_start, start_ms, default=energy)
            energy_lift = _clip01(0.5 + (energy - previous_energy) * 0.9)
            onset_density = _mean_between(onset, onset_times_ms, start_ms, end_ms)

            fingerprint = _chroma_summary(chroma, chroma_times_ms, start_ms, end_ms)
            chroma_cache[(start_ms, end_ms)] = fingerprint
            pre_fingerprint = _chroma_summary(chroma, chroma_times_ms, max(0, start_ms - 4000), start_ms)
            novelty = _clip01(1.0 - _cosine(pre_fingerprint, fingerprint))
            chroma_var_mask = (chroma_times_ms >= start_ms) & (chroma_times_ms < end_ms)
            chroma_var = float(np.mean(np.std(chroma[:, chroma_var_mask], axis=1))) if np.any(chroma_var_mask) else 0.0
            melodic_salience = _clip01(chroma_var * 4.0)
            start_fp = _chroma_summary(chroma, chroma_times_ms, start_ms, min(end_ms, start_ms + 1800))
            end_fp = _chroma_summary(chroma, chroma_times_ms, max(start_ms, end_ms - 1800), end_ms)
            loopability = _clip01(0.72 * _cosine(start_fp, end_fp) + 0.28 * (1.0 - abs(
                _mean_between(rms, rms_times_ms, start_ms, min(end_ms, start_ms + 1500)) -
                _mean_between(rms, rms_times_ms, max(start_ms, end_ms - 1500), end_ms)
            )))
            boundary_fit = 1.0 if start_ms in downbeats_ms and end_ms in downbeats_ms else 0.75 if start_ms in downbeats_ms else 0.55

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
                    "melodic_salience": melodic_salience,
                    "boundary_fit": boundary_fit,
                    "loopability": loopability,
                    "structure": _structure_score(section_type),
                    "repetition": 0.0,
                },
            })

    # Repetition is measured against non-overlapping candidate windows of comparable size.
    for candidate in raw:
        fp = chroma_cache[(candidate["start_ms"], candidate["end_ms"])]
        similarities: list[float] = []
        for other in raw:
            if other is candidate or abs(other["duration_ms"] - candidate["duration_ms"]) > 2500:
                continue
            overlap = max(0, min(candidate["end_ms"], other["end_ms"]) - max(candidate["start_ms"], other["start_ms"]))
            if overlap > candidate["duration_ms"] * 0.25:
                continue
            similarities.append(_cosine(fp, chroma_cache[(other["start_ms"], other["end_ms"])]))
        candidate["metrics"]["repetition"] = max(similarities, default=0.35)

        m = candidate["metrics"]
        score = (
            0.22 * m["repetition"] +
            0.18 * m["structure"] +
            0.14 * m["energy_lift"] +
            0.11 * m["energy"] +
            0.10 * m["novelty"] +
            0.09 * m["onset_density"] +
            0.07 * m["melodic_salience"] +
            0.05 * m["boundary_fit"] +
            0.04 * m["loopability"]
        )
        candidate["score"] = round(_clip01(score), 4)
        candidate["kind"] = _candidate_kind(m, candidate["section_type"])
        reasons: list[str] = []
        if m["repetition"] >= 0.75:
            reasons.append("Recurring musical material appears elsewhere in the track.")
        if m["structure"] >= 0.88:
            reasons.append(f"Strong structural position: {candidate['section_label']}.")
        if m["energy_lift"] >= 0.68:
            reasons.append("Clear energy lift into the window.")
        if m["onset_density"] >= 0.68:
            reasons.append("Rhythmically active, cut-friendly groove.")
        if m["melodic_salience"] >= 0.62:
            reasons.append("Distinct melodic/harmonic motion.")
        if m["loopability"] >= 0.72:
            reasons.append("Start and end are compatible with a short-form loop.")
        if m["boundary_fit"] >= 0.95:
            reasons.append("Starts and ends on detected downbeats.")
        candidate["reasons"] = reasons[:4] or ["Balanced musical and structural fit."]

    raw.sort(key=lambda item: (-item["score"], item["start_ms"], item["duration_ms"]))
    selected: list[dict[str, Any]] = []
    for candidate in raw:
        if any(
            abs(candidate["start_ms"] - existing["start_ms"]) < 2200
            and abs(candidate["duration_ms"] - existing["duration_ms"]) < 3500
            for existing in selected
        ):
            continue
        candidate = dict(candidate)
        candidate["id"] = f"hook-{len(selected) + 1}"
        candidate["label"] = f"{candidate['kind'].replace('_', ' ').title()} · {candidate['section_label']}"
        selected.append(candidate)
        if len(selected) >= 14:
            break
    return selected


def _social_cuts(candidates: list[dict[str, Any]]) -> dict[str, dict[str, Any] | None]:
    cuts: dict[str, dict[str, Any] | None] = {}
    for duration_ms in SOCIAL_DURATIONS_MS:
        eligible = sorted(
            candidates,
            key=lambda item: (
                abs(int(item["duration_ms"]) - duration_ms) / max(duration_ms, 1),
                -float(item["score"]),
                -float(item["metrics"].get("loopability", 0)),
            ),
        )
        candidate = eligible[0] if eligible else None
        cuts[str(duration_ms // 1000)] = None if candidate is None else {
            "candidate_id": candidate["id"],
            "start_ms": candidate["start_ms"],
            "end_ms": candidate["end_ms"],
            "score": candidate["score"],
            "kind": candidate["kind"],
            "label": candidate["label"],
        }
    return cuts


def analyze_music(path: Path) -> dict[str, Any]:
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
    if not downbeats_ms and beats_ms:
        downbeats_ms = beats_ms[::4]
        warnings.append("No downbeats were returned; every fourth beat is exposed as an inferred editing grid.")

    sample_step = max(1, int(round(len(rms) / 120)))
    energy_curve = [
        {"ms": int(round(rms_times_ms[index])), "value": round(float(rms[index]), 4)}
        for index in range(0, len(rms), sample_step)
        if rms_times_ms[index] <= duration_ms
    ]
    if not energy_curve or energy_curve[-1]["ms"] < duration_ms:
        energy_curve.append({"ms": duration_ms, "value": round(float(rms[-1]) if rms.size else 0.5, 4)})

    def onset_at(ms: int) -> float:
        frame = int(librosa.time_to_frames(ms / 1000, sr=sr, hop_length=hop))
        lo, hi = max(0, frame - 3), min(len(onset_norm), frame + 4)
        return float(np.max(onset_norm[lo:hi])) if hi > lo else 0.25

    edit_points = [
        {
            "ms": int(section["start_ms"]),
            "confidence": round(0.55 + 0.44 * onset_at(int(section["start_ms"])), 3),
            "reason": f"Structural transition into {str(section['label']).lower()}.",
        }
        for section in sections[1:]
    ]
    peak_candidates = np.argsort(rms)[::-1] if rms.size else []
    peaks_ms: list[int] = []
    for index in peak_candidates:
        ms = int(round(rms_times_ms[int(index)]))
        if all(abs(ms - existing) >= 8000 for existing in peaks_ms):
            peaks_ms.append(ms)
        if len(peaks_ms) >= 6:
            break
    peaks_ms.sort()

    beat_confidence = 0.0
    if beats_ms and onset_norm.size:
        frames = librosa.time_to_frames(np.asarray(beats_ms) / 1000, sr=sr, hop_length=hop)
        frames = np.clip(frames, 0, len(onset_norm) - 1)
        beat_confidence = float(np.mean(onset_norm[frames])) if len(frames) else 0.0

    candidates = _build_hook_candidates(
        duration_ms=duration_ms,
        sections=sections,
        downbeats_ms=downbeats_ms,
        rms=rms,
        rms_times_ms=rms_times_ms,
        onset=onset_norm,
        onset_times_ms=onset_times_ms,
        chroma=chroma,
        chroma_times_ms=chroma_times_ms,
    )

    return {
        "version": 2,
        "duration_ms": duration_ms,
        "bpm": structure["bpm"],
        "beat_confidence": round(_clip01(beat_confidence), 3),
        "beats_ms": beats_ms,
        "beat_positions": structure.get("beat_positions", []),
        "downbeats_ms": downbeats_ms,
        "sections": sections,
        "energy_curve": energy_curve,
        "edit_points": edit_points,
        "peaks_ms": peaks_ms,
        "hook_candidates": candidates,
        "social_cuts": _social_cuts(candidates),
        "analysis": {
            "engine": structure["engine"],
            "model": structure["model"],
            "quality": "full" if structure["semantic_structure"] else "fallback",
            "semantic_structure": bool(structure["semantic_structure"]),
            "real_downbeats": bool(structure["semantic_structure"]),
            "warnings": warnings,
        },
        "source": "worker",
    }
