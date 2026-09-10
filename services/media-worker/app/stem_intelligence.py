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
ANALYSIS_VERSION = 2
ACTIVITY_WINDOW_MS = 500


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


def _soft_relative(value: float, reference: float) -> float:
    if value <= 0 or reference <= 1e-9:
        return 0.0
    return _clamp01(0.96 * math.tanh((value / reference) * 1.15))


def _frame_slice(values: np.ndarray, start_ms: int, end_ms: int, sr: int) -> np.ndarray:
    start = max(0, int(round((start_ms / 1000.0) * sr / HOP_LENGTH)))
    end = max(start + 1, int(round((end_ms / 1000.0) * sr / HOP_LENGTH)))
    return values[start:min(len(values), end)]


def _window_score(
    rms: np.ndarray,
    onset: np.ndarray,
    start_ms: int,
    end_ms: int,
    sr: int,
    category: str,
) -> dict[str, float]:
    rms_window = _frame_slice(rms, start_ms, end_ms, sr)
    onset_window = _frame_slice(onset, start_ms, end_ms, sr)
    if not len(rms_window):
        return {"energy": 0.0, "onset": 0.0, "arc": 0.0, "score": 0.0}
    rms_reference = max(1e-6, float(np.percentile(rms, 97)))
    onset_reference = max(1e-6, float(np.percentile(onset, 97))) if len(onset) else 1.0
    energy = _soft_relative(float(np.mean(rms_window)), rms_reference)
    onset_score = _soft_relative(float(np.mean(onset_window)), onset_reference) if len(onset_window) else 0.0
    thirds = np.array_split(rms_window, 3)
    third_means = [float(np.mean(part)) if len(part) else 0.0 for part in thirds]
    arc = _soft_relative(max(third_means) - min(third_means), rms_reference)
    if category in {"drums", "percussion"}:
        score = _clamp01(energy * 0.32 + onset_score * 0.52 + arc * 0.16)
    elif category == "vocals":
        score = _clamp01(energy * 0.48 + onset_score * 0.18 + arc * 0.34)
    elif category == "bass":
        score = _clamp01(energy * 0.52 + onset_score * 0.22 + arc * 0.26)
    else:
        score = _clamp01(energy * 0.42 + onset_score * 0.28 + arc * 0.30)
    return {"energy": energy, "onset": onset_score, "arc": arc, "score": score}


def _best_moments(
    rms: np.ndarray,
    onset: np.ndarray,
    duration_ms: int,
    sr: int,
    category: str,
) -> list[dict[str, Any]]:
    target_ms = min(15000, duration_ms)
    if target_ms <= 1000:
        return []
    step_ms = max(500, min(1500, target_ms // 8))
    candidates: list[dict[str, Any]] = []
    for start_ms in range(0, max(1, duration_ms - target_ms + 1), step_ms):
        end_ms = min(duration_ms, start_ms + target_ms)
        metrics = _window_score(rms, onset, start_ms, end_ms, sr, category)
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
    duration_match = _clamp01(1.0 - abs(duration_delta_ms) / 1500.0)
    if not len(master_onset) or not len(stem_onset):
        confidence = 0.72 * duration_match
        return {
            "offset_ms": 0,
            "confidence": confidence,
            "timeline_confidence": confidence,
            "signal_correlation_confidence": 0.0,
            "method": "duration_evidence",
            "duration_delta_ms": duration_delta_ms,
            "evidence": {
                "duration_match": duration_match,
                "onset_correlation": 0.0,
                "support_event_count": 0,
                "support_confidence": 0.0,
            },
        }

    master_events = librosa.onset.onset_detect(
        onset_envelope=master_onset,
        sr=sr,
        hop_length=HOP_LENGTH,
        backtrack=False,
    )
    stem_events = librosa.onset.onset_detect(
        onset_envelope=stem_onset,
        sr=sr,
        hop_length=HOP_LENGTH,
        backtrack=False,
    )
    support_event_count = int(min(len(master_events), len(stem_events)))
    support_confidence = _clamp01((support_event_count - 1) / 4.0)

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

    signal_corr = _clamp01(max(0.0, best_corr))
    prominence = max(0.0, best_corr - max(0.0, runner_up))
    raw_correlation_confidence = _clamp01(signal_corr * 0.78 + min(1.0, prominence * 3.0) * 0.22)
    # A mathematically perfect correlation from one isolated transient is not enough evidence
    # to claim a trustworthy source offset. Require repeated onset support before signal
    # evidence can dominate the timeline confidence.
    evidence_strength = _clamp01(0.15 + support_confidence * 0.85)
    correlation_confidence = _clamp01(raw_correlation_confidence * evidence_strength)
    timeline_confidence = _clamp01(duration_match * 0.68 + correlation_confidence * 0.32)
    trustworthy_signal = correlation_confidence >= 0.32 and support_event_count >= 2
    offset_ms = int(round(best_lag * HOP_LENGTH * 1000.0 / sr)) if trustworthy_signal else 0
    return {
        "offset_ms": offset_ms,
        "confidence": timeline_confidence,
        "timeline_confidence": timeline_confidence,
        "signal_correlation_confidence": correlation_confidence,
        "method": "onset_cross_correlation" if trustworthy_signal else "duration_plus_sparse_signal",
        "duration_delta_ms": duration_delta_ms,
        "correlation": signal_corr,
        "evidence": {
            "duration_match": duration_match,
            "onset_correlation": signal_corr,
            "correlation_prominence": _clamp01(prominence * 3.0),
            "support_event_count": support_event_count,
            "support_confidence": support_confidence,
        },
    }


def _section_activity(
    rms: np.ndarray,
    onset: np.ndarray,
    sections: list[dict[str, Any]],
    sr: int,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    peak_rms = max(1e-6, float(np.percentile(rms, 97)))
    peak_onset = max(1e-6, float(np.percentile(onset, 97))) if len(onset) else 1.0
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
            "energy": _soft_relative(float(np.mean(rms_window)), peak_rms),
            "active_ratio": _clamp01(float(np.mean(rms_window >= active_threshold))),
            "rhythmic_activity": _soft_relative(float(np.mean(onset_window)), peak_onset) if len(onset_window) else 0.0,
        })
    return output


def _activity_curve(rms: np.ndarray, onset: np.ndarray, duration_ms: int, sr: int) -> list[dict[str, Any]]:
    if not len(rms):
        return []
    peak_rms = max(1e-6, float(np.percentile(rms, 97)))
    peak_onset = max(1e-6, float(np.percentile(onset, 97))) if len(onset) else 1.0
    active_threshold = max(float(np.percentile(rms, 25)) * 2.0, peak_rms * 0.08)
    result: list[dict[str, Any]] = []
    for start_ms in range(0, duration_ms, ACTIVITY_WINDOW_MS):
        end_ms = min(duration_ms, start_ms + ACTIVITY_WINDOW_MS)
        rms_window = _frame_slice(rms, start_ms, end_ms, sr)
        onset_window = _frame_slice(onset, start_ms, end_ms, sr)
        if not len(rms_window):
            continue
        energy = _soft_relative(float(np.mean(rms_window)), peak_rms)
        active_ratio = _clamp01(float(np.mean(rms_window >= active_threshold)))
        result.append({
            "start_ms": start_ms,
            "end_ms": end_ms,
            "energy": round(energy, 4),
            "active_ratio": round(active_ratio, 4),
            "rhythmic_activity": round(_soft_relative(float(np.mean(onset_window)), peak_onset), 4) if len(onset_window) else 0.0,
            "active": active_ratio >= 0.16 or energy >= 0.24,
        })
    return result


def _tempo_agreement(observed_bpm: float, canonical_bpm: float) -> float:
    if observed_bpm <= 0 or canonical_bpm <= 0:
        return 0.0
    ratio = observed_bpm / canonical_bpm
    octave_distance = abs(math.log2(ratio) - round(math.log2(ratio)))
    return _clamp01(1.0 - octave_distance / 0.18)


def _role_metrics(
    category: str,
    energy: float,
    active_ratio: float,
    rhythmic_activity: float,
    groove_stability: float,
    tonal_focus: float,
    spectral_motion: float,
    loopability: float,
    hook_score: float,
) -> dict[str, float]:
    common = {
        "energy": energy,
        "active_ratio": _clamp01(active_ratio),
        "hook_score": hook_score,
        "loopability": loopability,
    }
    if category in {"drums", "percussion"}:
        return {**common, "rhythmic_activity": rhythmic_activity, "groove_score": groove_stability, "spectral_motion": spectral_motion}
    if category == "bass":
        return {**common, "rhythmic_activity": rhythmic_activity, "groove_score": groove_stability, "tonal_focus": tonal_focus}
    if category == "vocals":
        return {**common, "tonal_focus": tonal_focus, "spectral_motion": spectral_motion}
    return {**common, "tonal_focus": tonal_focus, "spectral_motion": spectral_motion, "rhythmic_activity": rhythmic_activity}


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
    observed_tempo, beat_frames = librosa.beat.beat_track(y=mono, sr=TARGET_SR, hop_length=HOP_LENGTH)
    observed_bpm = _safe_float(observed_tempo)
    master_onset = librosa.onset.onset_strength(y=master, sr=TARGET_SR, hop_length=HOP_LENGTH)
    master_tempo, _ = librosa.beat.beat_track(onset_envelope=master_onset, sr=TARGET_SR, hop_length=HOP_LENGTH, trim=False)
    canonical_bpm = _safe_float(master_tempo)

    peak_rms = max(1e-9, float(np.percentile(rms, 97))) if len(rms) else 1e-9
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
    if category_lower in {"drums", "percussion"}:
        hook_score = _clamp01(energy * 0.22 + rhythmic_activity * 0.38 + groove_stability * 0.30 + spectral_motion * 0.10)
    elif category_lower == "bass":
        hook_score = _clamp01(energy * 0.34 + rhythmic_activity * 0.20 + groove_stability * 0.26 + tonal_focus * 0.20)
    elif category_lower == "vocals":
        hook_score = _clamp01(energy * 0.30 + tonal_focus * 0.24 + spectral_motion * 0.24 + active_ratio * 0.22)
    else:
        hook_score = _clamp01(energy * 0.28 + tonal_focus * 0.24 + spectral_motion * 0.28 + rhythmic_activity * 0.20)

    loopability = _loopability(mono, TARGET_SR)
    alignment = _alignment(master, mono, TARGET_SR, duration_ms - master_duration_ms)
    moments = _best_moments(rms, onset, duration_ms, TARGET_SR, category_lower)
    section_activity = _section_activity(rms, onset, sections or [], TARGET_SR)
    activity_curve = _activity_curve(rms, onset, duration_ms, TARGET_SR)

    leading_frames = int(np.argmax(rms >= active_threshold)) if len(rms) and np.any(rms >= active_threshold) else 0
    trailing_frames = int(np.argmax((rms >= active_threshold)[::-1])) if len(rms) and np.any(rms >= active_threshold) else 0
    leading_silence_ms = int(round(leading_frames * HOP_LENGTH * 1000.0 / TARGET_SR))
    trailing_silence_ms = int(round(trailing_frames * HOP_LENGTH * 1000.0 / TARGET_SR))
    role_metrics = _role_metrics(
        category_lower,
        energy,
        active_ratio,
        rhythmic_activity,
        groove_stability,
        tonal_focus,
        spectral_motion,
        loopability,
        hook_score,
    )

    return {
        "version": ANALYSIS_VERSION,
        "engine": "atlas_stem_intelligence_v2",
        "category": category_lower,
        "summary": role_metrics,
        "role_metrics": role_metrics,
        "tempo": {
            "bpm": canonical_bpm if canonical_bpm > 0 else None,
            "canonical_bpm": canonical_bpm if canonical_bpm > 0 else None,
            "canonical_source": "master_audio",
            "observed_stem_bpm": observed_bpm if observed_bpm > 0 else None,
            "tempo_agreement": _tempo_agreement(observed_bpm, canonical_bpm),
            "observed_beat_count": int(len(beat_frames)),
            "groove_stability": groove_stability,
        },
        "activity": {
            "transient_density_hz": transient_density,
            "leading_silence_ms": leading_silence_ms,
            "trailing_silence_ms": trailing_silence_ms,
        },
        "activity_curve": activity_curve,
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
        "provenance": {
            "canonical_clock": "master_audio",
            "timeline_alignment": "master_duration_plus_signal_evidence",
            "stem_role": "source_metadata",
            "derived_metrics": "atlas_stem_intelligence_v2",
        },
    }
