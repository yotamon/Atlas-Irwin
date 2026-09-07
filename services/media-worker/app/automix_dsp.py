from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

from .automix_intelligence import mastering_profile
from .automix_model import MAX_BEATMATCH_STRETCH, SAMPLE_RATE, TrackDescriptor, _list_records
from .mastering_processor import _measure_loudnorm, _render_loudnorm


def _load_segment(path: Path, start_ms: int, end_ms: int) -> np.ndarray:
    with sf.SoundFile(path) as handle:
        if handle.samplerate != SAMPLE_RATE:
            raise RuntimeError("AutoMix source was not standardized to 44.1 kHz")
        start = max(0, int(round(start_ms * SAMPLE_RATE / 1000.0)))
        end = min(len(handle), int(round(end_ms * SAMPLE_RATE / 1000.0)))
        handle.seek(start)
        audio = handle.read(max(0, end - start), dtype="float32", always_2d=True)
    if audio.shape[1] == 1:
        audio = np.repeat(audio, 2, axis=1)
    elif audio.shape[1] > 2:
        audio = audio[:, :2]
    return audio


def _stretch_audio(audio: np.ndarray, time_factor: float) -> np.ndarray:
    if abs(time_factor - 1.0) < 0.0025:
        return audio
    if abs(time_factor - 1.0) > MAX_BEATMATCH_STRETCH + 1e-6:
        raise ValueError(f"Refusing destructive AutoMix stretch factor {time_factor:.4f}")
    import python_stretch as ps
    stretch = ps.Signalsmith.Stretch()
    stretch.preset(audio.shape[1], SAMPLE_RATE)
    stretch.timeFactor = float(time_factor)
    processed = stretch.process(np.ascontiguousarray(audio.T, dtype=np.float32))
    result = np.asarray(processed, dtype=np.float32).T
    if result.ndim == 1:
        result = result[:, None]
    if result.shape[1] == 1:
        result = np.repeat(result, 2, axis=1)
    return result


def _integrated_loudness(audio: np.ndarray) -> float | None:
    if len(audio) < int(SAMPLE_RATE * 0.45):
        return None
    try:
        value = float(pyln.Meter(SAMPLE_RATE).integrated_loudness(audio.astype(np.float64, copy=False)))
        return value if math.isfinite(value) else None
    except Exception:
        return None


def _channel_gain_db(source_lufs: float | None, target_lufs: float | None, quality: dict[str, Any]) -> float:
    if source_lufs is None or target_lufs is None:
        return 0.0
    desired = target_lufs - source_lufs
    clipping = float(quality.get("clipping_ratio") or 0.0)
    quality_score = float(quality.get("quality_score") or 0.5)
    technical_ready = bool(quality.get("technical_ready", True))
    max_boost = 7.5
    if clipping > 0.0:
        max_boost = 0.0
    elif not technical_ready or quality_score < 0.58:
        max_boost = 2.0
    elif quality_score < 0.75:
        max_boost = 4.0
    return max(-10.0, min(max_boost, desired))


def _equal_power(length: int) -> tuple[np.ndarray, np.ndarray]:
    if length <= 1:
        return np.ones(max(1, length), dtype=np.float32), np.ones(max(1, length), dtype=np.float32)
    phase = np.linspace(0.0, math.pi / 2.0, length, dtype=np.float32)
    return np.cos(phase), np.sin(phase)


def _low_high(audio: np.ndarray, cutoff_hz: float = 180.0) -> tuple[np.ndarray, np.ndarray]:
    try:
        from scipy.signal import butter, sosfiltfilt
        sos = butter(4, cutoff_hz, btype="lowpass", fs=SAMPLE_RATE, output="sos")
        low = sosfiltfilt(sos, audio, axis=0).astype(np.float32, copy=False)
        return low, audio - low
    except Exception:
        return np.zeros_like(audio), audio


def _echo_tail(audio: np.ndarray, bpm: float, length: int) -> np.ndarray:
    if length <= 0:
        return np.zeros((0, 2), dtype=np.float32)
    source = audio[-min(len(audio), max(64, int(SAMPLE_RATE * 60.0 / max(60.0, bpm)))):]
    if not len(source):
        return np.zeros((length, 2), dtype=np.float32)
    delay = max(1, int(round(SAMPLE_RATE * 60.0 / max(60.0, bpm) * 0.75)))
    out = np.zeros((length, 2), dtype=np.float32)
    seed = source[-min(len(source), length):]
    out[:len(seed)] += seed
    for repeat, gain in ((1, 0.48), (2, 0.27), (3, 0.14)):
        start = repeat * delay
        if start >= length:
            break
        amount = min(len(seed), length - start)
        out[start:start + amount] += seed[:amount] * gain
    out *= np.linspace(1.0, 0.0, length, dtype=np.float32)[:, None]
    return out


def mix_transition(a: np.ndarray, b: np.ndarray, transition: dict[str, Any], a_bpm: float) -> np.ndarray:
    overlap_ms = int(transition.get("overlap_ms") or 0)
    length = min(len(a), len(b), int(round(overlap_ms * SAMPLE_RATE / 1000.0)))
    technique = str(transition.get("technique") or "drop_cut")
    if technique == "drop_cut" or length <= 0:
        return np.zeros((0, 2), dtype=np.float32)
    out_curve, in_curve = _equal_power(length)
    a_tail = a[-length:]
    b_head = b[:length]
    if technique in {"bass_swap", "harmonic_blend", "breakdown_swap", "quick_mix"}:
        a_low, a_high = _low_high(a_tail)
        b_low, b_high = _low_high(b_head)
        low_phase = np.linspace(0.0, 1.0, length, dtype=np.float32)
        a_low_gain = np.clip(1.0 - low_phase / 0.58, 0.0, 1.0)
        b_low_gain = np.clip((low_phase - 0.42) / 0.58, 0.0, 1.0)
        if technique == "harmonic_blend":
            a_low_gain = np.clip(1.0 - low_phase / 0.68, 0.0, 1.0)
            b_low_gain = np.clip((low_phase - 0.32) / 0.68, 0.0, 1.0)
        mixed = (
            a_high * out_curve[:, None]
            + b_high * in_curve[:, None]
            + a_low * (out_curve * a_low_gain)[:, None]
            + b_low * (in_curve * b_low_gain)[:, None]
        )
        return mixed.astype(np.float32, copy=False)
    if technique == "echo_out":
        echo = _echo_tail(a_tail, a_bpm, length)
        return (echo * out_curve[:, None] + b_head * in_curve[:, None]).astype(np.float32, copy=False)
    return (a_tail * out_curve[:, None] + b_head * in_curve[:, None]).astype(np.float32, copy=False)


def _scan_peaks(path: Path) -> tuple[float, float]:
    """Return sample peak and a conservative 4x oversampled true-peak estimate."""
    from scipy.signal import resample_poly

    sample_peak = 0.0
    true_peak = 0.0
    overlap = 4096
    previous: np.ndarray | None = None
    with sf.SoundFile(path) as handle:
        while True:
            block = handle.read(131072, dtype="float32", always_2d=True)
            if not len(block):
                break
            sample_peak = max(sample_peak, float(np.max(np.abs(block))))
            joined = np.concatenate((previous, block), axis=0) if previous is not None and len(previous) else block
            oversampled = resample_poly(joined, 4, 1, axis=0, padtype="line")
            true_peak = max(true_peak, float(np.max(np.abs(oversampled))))
            previous = joined[-overlap:].copy()
    return sample_peak, max(sample_peak, true_peak)


def _apply_ceiling(source: Path, target: Path, ceiling_dbtp: float = -1.0) -> tuple[float, float, float]:
    sample_peak, true_peak = _scan_peaks(source)
    ceiling = float(10.0 ** (ceiling_dbtp / 20.0))
    scale = min(1.0, ceiling / true_peak) if true_peak > 1e-9 else 1.0
    with sf.SoundFile(source) as inp, sf.SoundFile(
        target, "w", samplerate=inp.samplerate, channels=inp.channels, subtype="PCM_24"
    ) as out:
        while True:
            block = inp.read(262144, dtype="float32", always_2d=True)
            if not len(block):
                break
            out.write(block * scale)
    gain_db = 20.0 * math.log10(scale) if scale > 0 else -120.0
    return sample_peak, true_peak, gain_db


def _mix_loudness_target(purpose: str) -> float:
    return {
        "peak_time": -9.5,
        "booking": -10.0,
        "soundcloud": -10.5,
        "discovery": -10.5,
        "journey": -11.0,
        "warm_up": -11.5,
    }.get(purpose, -10.5)


def render_plan(tracks: list[TrackDescriptor], plan: dict[str, Any], workdir: Path) -> tuple[Path, dict[str, Any]]:
    by_id = {track.id: track for track in tracks}
    ordered_items = _list_records(plan.get("tracks"))
    transitions = _list_records(plan.get("transitions"))
    if not ordered_items:
        raise ValueError("AutoMix plan contains no tracks")

    selected_measurements: dict[str, float | None] = {}
    quality_profiles: dict[str, dict[str, Any]] = {}
    for item in ordered_items:
        track = by_id[str(item.get("track_id"))]
        audio = _load_segment(track.path, int(item["source_start_ms"]), int(item["source_end_ms"]))
        selected_measurements[track.id] = _integrated_loudness(audio)
        quality_profiles[track.id] = mastering_profile(track.music_map)
    measured_values = [value for value in selected_measurements.values() if value is not None]
    catalog_median = float(np.median(measured_values)) if measured_values else None
    channel_target_lufs = max(-13.0, min(-9.5, catalog_median)) if catalog_median is not None else -11.0
    normalization: dict[str, dict[str, Any]] = {}

    def render_item(item: dict[str, Any]) -> np.ndarray:
        track = by_id[str(item.get("track_id"))]
        audio = _load_segment(track.path, int(item["source_start_ms"]), int(item["source_end_ms"]))
        audio = _stretch_audio(audio, float(item.get("time_factor") or 1.0))
        source_lufs = selected_measurements.get(track.id)
        quality = quality_profiles[track.id]
        gain_db = _channel_gain_db(source_lufs, channel_target_lufs, quality)
        audio *= float(10.0 ** (gain_db / 20.0))
        normalization[track.id] = {
            "selected_window_lufs": round(source_lufs, 2) if source_lufs is not None else None,
            "channel_target_lufs": round(channel_target_lufs, 2),
            "gain_db": round(gain_db, 3),
            "mastering_quality_score": quality["quality_score"],
            "technical_ready": quality["technical_ready"],
            "clipping_guard": bool(float(quality.get("clipping_ratio") or 0.0) > 0.0),
        }
        return audio.astype(np.float32, copy=False)

    raw_path = workdir / "automix-raw.wav"
    timeline_ms = 0
    cue_tracks: list[dict[str, Any]] = [{
        "track_id": ordered_items[0]["track_id"],
        "title": ordered_items[0]["title"],
        "timeline_start_ms": 0,
    }]
    current = render_item(ordered_items[0])
    consumed_samples = 0

    with sf.SoundFile(raw_path, "w", samplerate=SAMPLE_RATE, channels=2, subtype="FLOAT") as out:
        for index, transition in enumerate(transitions):
            next_audio = render_item(ordered_items[index + 1])
            overlap_samples = min(
                len(current) - consumed_samples,
                len(next_audio),
                int(round(int(transition.get("overlap_ms") or 0) * SAMPLE_RATE / 1000.0)),
            )
            overlap_samples = max(0, overlap_samples)
            body_end = len(current) - overlap_samples
            body = current[consumed_samples:body_end].copy()

            if overlap_samples == 0 and len(body):
                ramp = min(len(body), int(SAMPLE_RATE * 0.012))
                body[-ramp:] *= np.linspace(1.0, 0.0, ramp, dtype=np.float32)[:, None]
                incoming = min(len(next_audio), int(SAMPLE_RATE * 0.012))
                if incoming:
                    next_audio[:incoming] *= np.linspace(0.0, 1.0, incoming, dtype=np.float32)[:, None]

            if len(body):
                out.write(body)
                timeline_ms += int(round(len(body) * 1000.0 / SAMPLE_RATE))

            if overlap_samples:
                transition_for_render = {**transition, "overlap_ms": int(round(overlap_samples * 1000.0 / SAMPLE_RATE))}
                transition_audio = mix_transition(
                    current,
                    next_audio,
                    transition_for_render,
                    float(ordered_items[index].get("playback_bpm") or 120.0),
                )
                transition["timeline_start_ms"] = timeline_ms
                out.write(transition_audio)
                cue_start = timeline_ms
                timeline_ms += int(round(len(transition_audio) * 1000.0 / SAMPLE_RATE))
                next_consumed = overlap_samples
            else:
                transition["timeline_start_ms"] = timeline_ms
                cue_start = timeline_ms
                next_consumed = 0

            cue_tracks.append({
                "track_id": ordered_items[index + 1]["track_id"],
                "title": ordered_items[index + 1]["title"],
                "timeline_start_ms": cue_start,
            })
            current = next_audio
            consumed_samples = next_consumed

        tail = current[consumed_samples:]
        if len(tail):
            out.write(tail)
            timeline_ms += int(round(len(tail) * 1000.0 / SAMPLE_RATE))

    final_target_lufs = _mix_loudness_target(str(plan.get("purpose") or "booking"))
    loudnorm_target = {
        "integrated_lufs": final_target_lufs,
        "true_peak_dbtp": -1.0,
        "max_lra_lu": 15.0,
    }
    normalized_path = workdir / "automix-loudness.wav"
    measurement = _measure_loudnorm(raw_path, loudnorm_target)
    _render_loudnorm(raw_path, normalized_path, loudnorm_target, measurement)

    final_path = workdir / "automix-master.wav"
    normalized_peak, normalized_true_peak, safety_trim_db = _apply_ceiling(normalized_path, final_path, -1.0)
    final_info = sf.info(final_path)
    duration_ms = int(round(final_info.duration * 1000.0))
    final_lufs = None
    try:
        with sf.SoundFile(final_path) as handle:
            data = handle.read(dtype="float32", always_2d=True)
        final_lufs = _integrated_loudness(data)
    except Exception:
        pass
    return final_path, {
        "duration_ms": duration_ms,
        "sample_rate": int(final_info.samplerate),
        "channel_loudness_target_lufs": round(channel_target_lufs, 2),
        "catalog_selected_window_median_lufs": round(catalog_median, 2) if catalog_median is not None else None,
        "final_target_lufs": final_target_lufs,
        "final_measured_lufs": round(final_lufs, 2) if final_lufs is not None else None,
        "post_loudnorm_sample_peak": round(normalized_peak, 6),
        "post_loudnorm_true_peak_estimate": round(normalized_true_peak, 6),
        "ceiling_dbtp": -1.0,
        "safety_trim_db": round(safety_trim_db, 4),
        "normalization": normalization,
        "cue_tracks": cue_tracks,
        "finalizer": "ffmpeg_loudnorm_two_pass_plus_4x_true_peak_guard",
    }
