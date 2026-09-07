from __future__ import annotations

import math
from typing import Any

import numpy as np

from .automix_model import (
    AUTOMIX_VERSION, MAX_BEATMATCH_STRETCH, EnergyProfile, Purpose, TrackDescriptor, TransitionStyle,
    _clip01, _list_records, harmonic_compatibility, bpm_compatibility,
)


def _energy_target(position: float, purpose: Purpose, profile: EnergyProfile) -> float:
    x = _clip01(position)
    if purpose == "warm_up":
        base = 0.35 + 0.42 * x
    elif purpose == "peak_time":
        base = 0.78 + 0.18 * math.sin(min(1.0, x * 1.2) * math.pi / 2)
    elif purpose == "booking":
        base = 0.62 + 0.34 * math.sin(min(1.0, x * 1.25) * math.pi / 2)
        if x > 0.86:
            base -= (x - 0.86) * 0.65
    elif purpose == "journey":
        base = 0.38 + 0.48 * math.sin(x * math.pi * 0.86)
    else:
        base = 0.45 + 0.42 * math.sin(x * math.pi * 0.82)
    if profile == "peak":
        base += 0.09
    elif profile == "smooth":
        base = 0.5 + (base - 0.5) * 0.72
    return _clip01(base)


def transition_score(a: TrackDescriptor, b: TrackDescriptor, position: float, purpose: Purpose, profile: EnergyProfile) -> dict[str, float]:
    harmonic = harmonic_compatibility(a.key, b.key)
    tempo, stretch_delta = bpm_compatibility(a.dj_bpm, b.dj_bpm)
    energy_target = _energy_target(position, purpose, profile)
    energy_fit = _clip01(1.0 - abs(b.energy - energy_target) / 0.65)
    flow = _clip01(1.0 - max(0.0, a.energy - b.energy - 0.18) / 0.55)
    safe_stretch = 1.0 if stretch_delta <= MAX_BEATMATCH_STRETCH else _clip01(1.0 - (stretch_delta - MAX_BEATMATCH_STRETCH) / 0.12)
    total = _clip01(0.30 * harmonic + 0.26 * tempo + 0.20 * energy_fit + 0.12 * flow + 0.12 * safe_stretch)
    return {
        "total": total,
        "harmonic": harmonic,
        "tempo": tempo,
        "energy_fit": energy_fit,
        "flow": flow,
        "stretch_delta": stretch_delta,
    }


def order_tracks(tracks: list[TrackDescriptor], purpose: Purpose, profile: EnergyProfile) -> list[TrackDescriptor]:
    if len(tracks) <= 2 or purpose == "journey":
        return tracks
    beam: list[tuple[float, tuple[int, ...]]] = []
    n = len(tracks)
    for index, track in enumerate(tracks):
        target = _energy_target(0.0, purpose, profile)
        identity = track.window_score
        start_fit = _clip01(1.0 - abs(track.energy - target) / 0.7)
        beam.append((0.58 * identity + 0.42 * start_fit, (index,)))
    beam.sort(reverse=True, key=lambda item: item[0])
    beam = beam[: min(24, len(beam))]
    for depth in range(1, n):
        expanded: list[tuple[float, tuple[int, ...]]] = []
        position = depth / max(1, n - 1)
        for score, path in beam:
            last = tracks[path[-1]]
            used = set(path)
            for nxt in range(n):
                if nxt in used:
                    continue
                metrics = transition_score(last, tracks[nxt], position, purpose, profile)
                novelty = 0.025 if tracks[nxt].key.camelot != last.key.camelot else 0.0
                expanded.append((score + metrics["total"] + novelty, (*path, nxt)))
        expanded.sort(reverse=True, key=lambda item: item[0])
        beam = expanded[:128]
    return [tracks[index] for index in beam[0][1]] if beam else tracks


def _section_label_near(music_map: dict[str, Any], ms: int) -> str:
    for section in _list_records(music_map.get("sections")):
        start = int(section.get("start_ms") or 0)
        end = int(section.get("end_ms") or 0)
        if start <= ms <= end:
            return str(section.get("label") or "").lower()
    return ""


def choose_transition(a: TrackDescriptor, b: TrackDescriptor, score: dict[str, float], style: TransitionStyle) -> tuple[str, int, bool, list[str]]:
    stretch_delta = score["stretch_delta"]
    beatmatch = stretch_delta <= MAX_BEATMATCH_STRETCH
    a_label = _section_label_near(a.music_map, a.window_end_ms)
    b_label = _section_label_near(b.music_map, b.window_start_ms)
    sparse = any(word in f"{a_label} {b_label}" for word in ("intro", "outro", "break", "bridge", "instrumental"))
    reasons: list[str] = []

    if beatmatch and score["harmonic"] >= 0.84 and sparse and style != "clean":
        technique, bars = "harmonic_blend", 32
        reasons.append("compatible key and phrase-safe sparse material")
    elif beatmatch and score["tempo"] >= 0.78 and style != "clean":
        technique, bars = "bass_swap", 16
        reasons.append("tempo-compatible phrase transition with controlled low-end handoff")
    elif beatmatch and style == "clean":
        technique, bars = "quick_mix", 8
        reasons.append("clean beatmatched transition")
    elif score["harmonic"] < 0.52 or stretch_delta > 0.10:
        technique, bars, beatmatch = "echo_out", 0, False
        reasons.append("avoids forcing an audible tempo or harmonic mismatch")
    else:
        technique, bars, beatmatch = "drop_cut", 0, False
        reasons.append("phrase-aligned cut preserves both masters without destructive stretching")

    if style == "creative" and beatmatch and technique == "bass_swap" and sparse:
        technique, bars = "breakdown_swap", 16
        reasons.append("creative contrast is supported by the surrounding sections")
    return technique, bars, beatmatch, reasons


def _cluster_playback_bpms(ordered: list[TrackDescriptor], transitions: list[dict[str, Any]]) -> list[float]:
    targets = [track.dj_bpm for track in ordered]
    index = 0
    while index < len(ordered):
        end = index
        while end < len(transitions) and bool(transitions[end].get("beatmatch")):
            end += 1
        cluster = ordered[index:end + 1]
        if len(cluster) > 1:
            median = float(np.median([track.dj_bpm for track in cluster]))
            if all(abs(median / max(1e-6, track.dj_bpm) - 1.0) <= MAX_BEATMATCH_STRETCH for track in cluster):
                for offset in range(index, end + 1):
                    targets[offset] = median
        index = max(index + 1, end + 1)
    return targets


def build_plan(tracks: list[TrackDescriptor], purpose: Purpose, profile: EnergyProfile, style: TransitionStyle, target_duration_ms: int) -> dict[str, Any]:
    ordered = order_tracks(tracks, purpose, profile)
    transitions: list[dict[str, Any]] = []
    for index, (a, b) in enumerate(zip(ordered[:-1], ordered[1:])):
        metrics = transition_score(a, b, (index + 1) / max(1, len(ordered) - 1), purpose, profile)
        technique, bars, beatmatch, reasons = choose_transition(a, b, metrics, style)
        transitions.append({
            "from_track_id": a.id,
            "to_track_id": b.id,
            "technique": technique,
            "bars": bars,
            "beatmatch": beatmatch,
            "score": round(metrics["total"], 4),
            "metrics": {key: round(value, 4) for key, value in metrics.items()},
            "reasons": reasons,
        })

    playback_bpms = _cluster_playback_bpms(ordered, transitions)
    timeline_tracks: list[dict[str, Any]] = []
    for index, track in enumerate(ordered):
        source_start = track.window_start_ms
        source_end = track.window_end_ms
        playback_bpm = playback_bpms[index]
        factor = playback_bpm / max(1e-6, track.dj_bpm)
        timeline_tracks.append({
            "track_id": track.id,
            "title": track.title,
            "source_start_ms": source_start,
            "source_end_ms": source_end,
            "source_bpm": round(track.bpm, 4),
            "dj_bpm": round(track.dj_bpm, 4),
            "playback_bpm": round(playback_bpm, 4),
            "time_factor": round(factor, 7),
            "key": {"label": track.key.label, "camelot": track.key.camelot, "confidence": round(track.key.confidence, 4)},
            "energy": round(track.energy, 4),
            "window_score": round(track.window_score, 4),
        })

    for index, transition in enumerate(transitions):
        a = ordered[index]
        b = ordered[index + 1]
        if transition["beatmatch"]:
            bpm = playback_bpms[index]
            beat_ms = 60_000.0 / max(1.0, bpm)
            requested = int(round(transition["bars"] * 4 * beat_ms))
            max_a = int((a.window_end_ms - a.window_start_ms) * a.dj_bpm / max(1.0, bpm) * 0.42)
            max_b = int((b.window_end_ms - b.window_start_ms) * b.dj_bpm / max(1.0, bpm) * 0.42)
            overlap = max(0, min(requested, max_a, max_b))
            if overlap < int(round(4 * beat_ms)):
                transition["technique"] = "drop_cut"
                transition["beatmatch"] = False
                transition["bars"] = 0
                overlap = 0
                transition["reasons"].append("available phrase window was too short for a safe blend")
        elif transition["technique"] == "echo_out":
            overlap = 1800
        else:
            overlap = 0
        transition["overlap_ms"] = overlap

    estimated = 0
    for track, item in zip(ordered, timeline_tracks):
        estimated += int(round((track.window_end_ms - track.window_start_ms) / max(1e-6, float(item["time_factor"]))))
    estimated -= sum(int(item.get("overlap_ms") or 0) for item in transitions)
    return {
        "version": AUTOMIX_VERSION,
        "purpose": purpose,
        "energy_profile": profile,
        "transition_style": style,
        "requested_duration_ms": target_duration_ms,
        "estimated_duration_ms": max(0, estimated),
        "tracks": timeline_tracks,
        "transitions": transitions,
        "quality_contract": {
            "max_beatmatch_stretch_percent": int(MAX_BEATMATCH_STRETCH * 100),
            "pitch_shift_semitones": 0,
            "master_preservation": True,
            "phrase_aligned": True,
            "harmonic_ordering": True,
            "low_end_collision_control": True,
        },
    }
