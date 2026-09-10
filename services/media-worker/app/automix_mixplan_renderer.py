from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from .automix_dsp import (
    _apply_ceiling,
    _channel_gain_db,
    _integrated_loudness,
    _load_segment,
    _measure_loudnorm,
    _mix_loudness_target,
    _render_loudnorm,
    _stretch_audio,
)
from .automix_intelligence import mastering_profile
from .automix_manifest import MIXPLAN_VERSION, mixplan_hash, validate_mixplan
from .automix_model import SAMPLE_RATE, TrackDescriptor
from .automix_transition_dsp_v2 import mix_transition_v2


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _records(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def render_mixplan(
    tracks: list[TrackDescriptor],
    manifest: dict[str, Any],
    workdir: Path,
) -> tuple[Path, dict[str, Any]]:
    validate_mixplan(manifest)
    expected_hash = str(manifest.get("plan_hash") or "")
    actual_hash = mixplan_hash(manifest)
    if expected_hash and expected_hash != actual_hash:
        raise ValueError("MixPlan hash does not match its canonical render instructions")

    by_id = {track.id: track for track in tracks}
    ordered_items = _records(manifest.get("tracks"))
    transitions = _records(manifest.get("transitions"))
    manifest_ids = [str(item.get("track_id") or "") for item in ordered_items]
    if any(track_id not in by_id for track_id in manifest_ids):
        raise ValueError("MixPlan references a source track that is unavailable to this renderer")

    selected_measurements: dict[str, float | None] = {}
    quality_profiles: dict[str, dict[str, Any]] = {}
    for item in ordered_items:
        track = by_id[str(item["track_id"])]
        source = _record(item.get("source"))
        audio = _load_segment(track.path, int(source["start_ms"]), int(source["end_ms"]))
        selected_measurements[track.id] = _integrated_loudness(audio)
        quality_profiles[track.id] = mastering_profile(track.music_map)
    measured_values = [value for value in selected_measurements.values() if value is not None]
    catalog_median = float(np.median(measured_values)) if measured_values else None
    channel_target_lufs = max(-13.0, min(-9.5, catalog_median)) if catalog_median is not None else -11.0
    normalization: dict[str, dict[str, Any]] = {}

    def render_item(item: dict[str, Any]) -> np.ndarray:
        track = by_id[str(item["track_id"])]
        source = _record(item.get("source"))
        playback = _record(item.get("playback"))
        audio = _load_segment(track.path, int(source["start_ms"]), int(source["end_ms"]))
        audio = _stretch_audio(audio, float(playback.get("time_factor") or 1.0))
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
    transition_timeline: list[dict[str, Any]] = []
    cue_tracks: list[dict[str, Any]] = [{
        "track_id": ordered_items[0]["track_id"],
        "title": ordered_items[0].get("title"),
        "timeline_start_ms": 0,
    }]
    current = render_item(ordered_items[0])
    consumed_samples = 0

    with sf.SoundFile(raw_path, "w", samplerate=SAMPLE_RATE, channels=2, subtype="FLOAT") as out:
        for index, transition in enumerate(transitions):
            next_audio = render_item(ordered_items[index + 1])
            planned_overlap = int(transition.get("overlap_ms") or 0)
            overlap_samples = min(
                max(0, len(current) - consumed_samples),
                len(next_audio),
                int(round(planned_overlap * SAMPLE_RATE / 1000.0)),
            )
            overlap_samples = max(0, overlap_samples)
            body_end = len(current) - overlap_samples
            body = current[consumed_samples:body_end].copy()
            if overlap_samples == 0 and len(body):
                ramp = min(len(body), int(SAMPLE_RATE * 0.012))
                if ramp:
                    body[-ramp:] *= np.linspace(1.0, 0.0, ramp, dtype=np.float32)[:, None]
                incoming = min(len(next_audio), int(SAMPLE_RATE * 0.012))
                if incoming:
                    next_audio[:incoming] *= np.linspace(0.0, 1.0, incoming, dtype=np.float32)[:, None]
            if len(body):
                out.write(body)
                timeline_ms += int(round(len(body) * 1000.0 / SAMPLE_RATE))

            transition_start = timeline_ms
            if overlap_samples:
                render_transition = {
                    **transition,
                    "overlap_ms": int(round(overlap_samples * 1000.0 / SAMPLE_RATE)),
                }
                transition_audio = mix_transition_v2(
                    current,
                    next_audio,
                    render_transition,
                    float(_record(ordered_items[index].get("playback")).get("bpm") or 120.0),
                )
                out.write(transition_audio)
                timeline_ms += int(round(len(transition_audio) * 1000.0 / SAMPLE_RATE))
                next_consumed = overlap_samples
            else:
                next_consumed = 0
            transition_timeline.append({
                "index": index,
                "from_track_id": transition.get("from_track_id"),
                "to_track_id": transition.get("to_track_id"),
                "technique": transition.get("technique"),
                "timeline_start_ms": transition_start,
                "rendered_overlap_ms": int(round(overlap_samples * 1000.0 / SAMPLE_RATE)),
                "automation_version": _record(transition.get("automation")).get("version"),
            })
            cue_tracks.append({
                "track_id": ordered_items[index + 1]["track_id"],
                "title": ordered_items[index + 1].get("title"),
                "timeline_start_ms": transition_start,
            })
            current = next_audio
            consumed_samples = next_consumed

        tail = current[consumed_samples:]
        if len(tail):
            out.write(tail)
            timeline_ms += int(round(len(tail) * 1000.0 / SAMPLE_RATE))

    final_target_lufs = _mix_loudness_target(str(manifest.get("purpose") or "booking"))
    loudnorm_target = {"integrated_lufs": final_target_lufs, "true_peak_dbtp": -1.0, "max_lra_lu": 15.0}
    normalized_path = workdir / "automix-loudness.wav"
    measurement = _measure_loudnorm(raw_path, loudnorm_target)
    _render_loudnorm(raw_path, normalized_path, loudnorm_target, measurement)
    final_path = workdir / "automix-master.wav"
    normalized_peak, normalized_true_peak, safety_trim_db = _apply_ceiling(normalized_path, final_path, -1.0)
    final_info = sf.info(final_path)
    duration_ms = int(round(final_info.duration * 1000.0))
    final_lufs = None
    try:
        final_measurement = _measure_loudnorm(final_path, loudnorm_target)
        parsed = float(final_measurement.get("input_i"))
        final_lufs = parsed if math.isfinite(parsed) else None
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
        "transition_timeline": transition_timeline,
        "finalizer": "ffmpeg_loudnorm_two_pass_plus_4x_true_peak_guard",
        "mixplan_version": MIXPLAN_VERSION,
        "mixplan_hash": actual_hash,
        "render_contract": "native_mixplan_v2",
        "transition_dsp": "versioned_automation_v1",
    }
