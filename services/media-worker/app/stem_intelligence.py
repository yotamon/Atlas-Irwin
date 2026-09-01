from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import librosa
import numpy as np
import soundfile as sf

TARGET_SR = 44100
HOP_LENGTH = 512
FRAME_LENGTH = 2048
ANALYSIS_VERSION = 1


def _clamp01(value: float) -> float:
    return float(max(0.0, min(1.0, value)))


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(np.asarray(value).reshape(-1)[0])
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError, IndexError):
        return default


def _normalized_db_score(value: float, floor_db: float = -42.0, ceiling_db: float = -8.0) -> float:
    if value <= 1e-12:
        return 0.0
    db = 20.0 * math.log10(value)
    return _clamp01((db - floor_db) / max(1e-6, ceiling_db - floor_db))


def _frame_slice(values: np.ndarray, start_ms: int, end_ms: int, sr: int) -> np.ndarray:
    start = max(0, int(round((start_ms / 1000.0) * sr / HOP_LENGTH)))
    end = max(start + 1, int(round((end_ms / 1000.0) * sr / HOP_LENGTH)))
    return values[start:min(len(values), end)]


def _window_score(rms: np.ndarray, onset: np.ndarray, start_ms: int, end_ms: int, sr: int) -> dict[str, float]:
    rms_window = _frame_slice(rms, start_ms, end_ms, sr)
    onset_window = _frame_slice(onset, start_ms, end_ms, sr)
    if not len(rms_window):
        return {"energy": 0.0, "onset": 0.0, "arc": 0.0, "score": 0.0}
    energy = _clamp01(float(np.mean(rms_window)) / max(1e-6, float(np.percentile(rms, 95))))
    onset_score = _clamp01(float(np.mean(onset_window)) / max(1e-6, float(np.percentile(onset, 95)))) if len(onset_window) else 0.0
    thirds = np.array_split(rms_window, 3)
    third_means = [float(np.mean(part)) if len(part) else 0.0 for part in thirds]
    arc = _clamp01((max(third_means) - min(third_means)) / max(1e-6, float(np.percentile(rms, 95))))
    score = _clamp01(energy * 0.5 + onset_score * 0.3 + arc * 0.2)
    return {"energy": energy, "onset": onset_score, "arc": arc, "score": score}


def _best_moments(rms: np.ndarray, onset: np.ndarray, duration_ms: int, sr: int) -> list[dict[str, Any]]:
    target_ms = min(15000, duration_ms)
    if target_ms <= 1000:
        return []
    step_ms = max(500, min(1500, target_ms // 8))
    candidates: list[dict[str, Any]] = []
    for start_ms in range(0, max(1, duration_ms - target_ms + 1), step_ms):
        end_ms = min(duration_ms, start_ms + target_ms)
        metrics = _window_score(rms, onset, start_ms, end_ms, sr)
        candidates.append({"start_ms": start_ms, "end_ms": end_ms, **metrics})
    candidates.sort(key=lambda item: float(item["score"]), reverse=True)
    selected: list[dict[str, Any]] = []
    for candidate in candidates:
        if any(
            min(candidate["end_ms"], existing["end_ms"]) - max(candidate["start_ms"], existing["start_ms"]) > target_ms * 0.35
            for existing in selected
        ):
            continue
        selected.append(candidate)
        if len(selected) >= 3:
            break
    return selected


def _loopability(y: np.ndarray, sr: int) -> float:
    edge = min(len(y) // 4, max(256, int(sr * 0.25)))
    if edge <= 255:
        return 0.0
    start = y[:edge]
    end = y[-edge:]
    start_rms = float(np.sqrt(np.mean(start * start) + 1e-12))
    end_rms = float(np.sqrt(np.mean(end * end) + 1e-12))
    energy_match = 1.0 - min(1.0, abs(start_rms - end_rms) / max(start_rms, end_rms, 1e-6))
    start_spec = np.abs(np.fft.rfft(start * np.hanning(edge)))
    end_spec = np.abs(np.fft.rfft(end * np.hanning(edge)))
    denom = float(np.linalg.norm(start_spec) * np.linalg.norm(end_spec))
    spectral_match = float(np.dot(start_spec, end_spec) / denom) if denom > 1e-9 else 0.0
    return _clamp01(energy_match * 0.45 + spectral_match * 0.55)


def _alignment(master: np.ndarray, stem: np.ndarray, sr: int, duration_delta_ms: int) -> dict[str, Any]:
    master_onset = librosa.onset.onset_strength(y=master, sr=sr, hop_length=HOP_LENGTH)
    stem_onset = librosa.onset.onset_strength(y=stem, sr=sr, hop_length=HOP_LENGTH)
    if not len(master_onset) or not len(stem_onset):
        return {"offset_ms": 0, "confidence": 0.0, "method": "duration_only", "duration_delta_ms": duration_delta_ms}

    master_onset = (master_onset - float(np.mean(master_onset))) / max(float(np.std(master_onset)), 1e-6)
    stem_onset = (stem_onset - float(np.mean(stem_onset))) / max(float(np.std(stem_onset)), 1e-6)
    max_lag = int(round(5.0 * sr / HOP_LENGTH))
    best_lag = 0
    best_corr = -1.0
    runner_up = -1.0
    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            a = master_onset[lag:min(len(master_onset), lag + len(stem_onset))]
            b = stem_onset[:len(a)]
        else:
            b = stem_onset[-lag:min(len(stem_onset), -lag + len(master_onset))]
            a = master_onset[:len(b)]
        if len(a) < 32:
            continue
        corr = float(np.dot(a, b) / max(1.0, len(a)))
        if corr > best_corr:
            runner_up = best_corr
            best_corr = corr
            best_lag = lag
        elif corr > runner_up:
            runner_up = corr

    offset_ms = int(round(best_lag * HOP_LENGTH * 1000.0 / sr))
    prominence = max(0.0, best_corr - max(0.0, runner_up))
    confidence = _clamp01(max(0.0, best_corr) * 0.65 + min(1.0, prominence * 3.0) * 0.2 + (1.0 if abs(duration_delta_ms) <= 250 else 0.4) * 0.15)
    if confidence < 0.28:
        offset_ms = 0
    return {
        "offset_ms": offset_ms,
        "confidence": confidence,
        "method": "onset_cross_correlation" if confidence >= 0.28 else "duration_guard",
        "duration_delta_ms": duration_delta_ms,
        "correlation": max(0.0, best_corr),
    }


def _section_activity(
    rms: np.ndarray,
    onset: np.ndarray,
    sections: list[dict[str, Any]],
    sr: int,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    peak_rms = max(1e-6, float(np.percentile(rms, 95)))
    peak_onset = max(1e-6, float(np.percentile(onset, 95))) if len(onset) else 1.0
    active_threshold = max(float(np.percentile(rms, 25)) * 2.0, peak_rms * 0.08)
    for section in sections[:80]:
        try:
            start_ms = max(0, int(section.get("start_ms", 0)))
            end_ms = max(start_ms + 1, int(section.get("end_ms", 0)))
        except (TypeError, ValueError):
            continue
        rms_window = _frame_slice(rms, start_ms, end_ms, sr)
        onset_window = _frame_slice(onset, start_ms, end_ms, sr)
        if not len(rms_window):
            continue
        output.append({
            "section_id": section.get("id"),
            "label": section.get("label"),
            "start_ms": start_ms,
            "end_ms": end_ms,
            "energy": _clamp01(float(np.mean(rms_window)) / peak_rms),
            "active_ratio": _clamp01(float(np.mean(rms_window >= active_threshold))),
            "rhythmic_activity": _clamp01(float(np.mean(onset_window)) / peak_onset) if len(onset_window) else 0.0,
        })
    return output


def analyze_stem(
    stem_path: Path,
    master_path: Path,
    category: str,
    sections: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    audio, source_sr = sf.read(stem_path, always_2d=True, dtype="float32")
    source_channels = int(audio.shape[1])
    mono = np.mean(audio, axis=1)
    if source_sr != TARGET_SR:
        mono = librosa.resample(mono, orig_sr=source_sr, target_sr=TARGET_SR, res_type="soxr_hq")
    master, master_sr = librosa.load(master_path, sr=TARGET_SR, mono=True, res_type="soxr_hq")
    if master_sr != TARGET_SR:
        master = librosa.resample(master, orig_sr=master_sr, target_sr=TARGET_SR, res_type="soxr_hq")

    duration_ms = int(round(len(mono) * 1000.0 / TARGET_SR))
    master_duration_ms = int(round(len(master) * 1000.0 / TARGET_SR))
    rms = librosa.feature.rms(y=mono, frame_length=FRAME_LENGTH, hop_length=HOP_LENGTH)[0]
    onset = librosa.onset.onset_strength(y=mono, sr=TARGET_SR, hop_length=HOP_LENGTH)
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset, sr=TARGET_SR, hop_length=HOP_LENGTH, backtrack=False)
    tempo, beat_frames = librosa.beat.beat_track(y=mono, sr=TARGET_SR, hop_length=HOP_LENGTH)
    bpm = _safe_float(tempo)

    peak_rms = max(1e-9, float(np.percentile(rms, 95))) if len(rms) else 1e-9
    mean_rms = float(np.mean(rms)) if len(rms) else 0.0
    active_threshold = max(float(np.percentile(rms, 25)) * 2.0, peak_rms * 0.08) if len(rms) else 1.0
    active_ratio = float(np.mean(rms >= active_threshold)) if len(rms) else 0.0
    transient_density = len(onset_frames) / max(1.0, duration_ms / 1000.0)

    beat_times = librosa.frames_to_time(beat_frames, sr=TARGET_SR, hop_length=HOP_LENGTH)
    if len(beat_times) >= 4:
        intervals = np.diff(beat_times)
        cv = float(np.std(intervals) / max(1e-6, np.mean(intervals)))
        groove_stability = _clamp01(1.0 - cv * 3.0)
    else:
        groove_stability = 0.0

    centroid = librosa.feature.spectral_centroid(y=mono, sr=TARGET_SR, hop_length=HOP_LENGTH)[0]
    flatness = librosa.feature.spectral_flatness(y=mono, hop_length=HOP_LENGTH)[0]
    spectral_motion = _clamp01(float(np.std(centroid)) / max(1.0, float(np.mean(centroid)))) if len(centroid) else 0.0
    tonal_focus = _clamp01(1.0 - float(np.mean(flatness)) * 4.0) if len(flatness) else 0.0

    energy = _normalized_db_score(mean_rms)
    rhythmic_activity = _clamp01(transient_density / 4.0)
    category_lower = category.lower()
    if category_lower in {"drums", "percussion", "bass"}:
        hook_score = _clamp01(energy * 0.28 + rhythmic_activity * 0.32 + groove_stability * 0.28 + spectral_motion * 0.12)
    elif category_lower == "vocals":
        hook_score = _clamp01(energy * 0.28 + tonal_focus * 0.25 + spectral_motion * 0.27 + active_ratio * 0.20)
    else:
        hook_score = _clamp01(energy * 0.28 + tonal_focus * 0.24 + spectral_motion * 0.28 + rhythmic_activity * 0.20)

    loopability = _loopability(mono, TARGET_SR)
    alignment = _alignment(master, mono, TARGET_SR, duration_ms - master_duration_ms)
    moments = _best_moments(rms, onset, duration_ms, TARGET_SR)
    section_activity = _section_activity(rms, onset, sections or [], TARGET_SR)

    leading_frames = int(np.argmax(rms >= active_threshold)) if len(rms) and np.any(rms >= active_threshold) else 0
    trailing_frames = int(np.argmax((rms >= active_threshold)[::-1])) if len(rms) and np.any(rms >= active_threshold) else 0
    leading_silence_ms = int(round(leading_frames * HOP_LENGTH * 1000.0 / TARGET_SR))
    trailing_silence_ms = int(round(trailing_frames * HOP_LENGTH * 1000.0 / TARGET_SR))

    return {
        "version": ANALYSIS_VERSION,
        "engine": "atlas_stem_intelligence",
        "category": category_lower,
        "summary": {
            "energy": energy,
            "active_ratio": _clamp01(active_ratio),
            "rhythmic_activity": rhythmic_activity,
            "groove_score": groove_stability,
            "loopability": loopability,
            "hook_score": hook_score,
            "tonal_focus": tonal_focus,
            "spectral_motion": spectral_motion,
        },
        "tempo": {
            "bpm": bpm if bpm > 0 else None,
            "beat_count": int(len(beat_frames)),
            "groove_stability": groove_stability,
        },
        "activity": {
            "transient_density_hz": transient_density,
            "leading_silence_ms": leading_silence_ms,
            "trailing_silence_ms": trailing_silence_ms,
        },
        "best_moments": moments,
        "section_activity": section_activity,
        "alignment": alignment,
        "technical": {
            "duration_ms": duration_ms,
            "master_duration_ms": master_duration_ms,
            "source_sample_rate": int(source_sr),
            "source_channels": source_channels,
            "analysis_sample_rate": TARGET_SR,
        },
    }
