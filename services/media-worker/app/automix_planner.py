from __future__ import annotations

import math
from collections import Counter
from dataclasses import replace
from typing import Any

import numpy as np

from .automix_intelligence import (
    mastering_profile,
    tempo_profile,
    transition_activity,
    transition_boundary_evidence,
)
from .automix_model import (
    AUTOMIX_VERSION, MAX_BEATMATCH_STRETCH, MIN_TRACK_WINDOW_MS, EnergyProfile, Purpose,
    TrackDescriptor, TransitionStyle, _clip01, _list_records, harmonic_compatibility,
    bpm_compatibility,
)
from .automix_transition_regions import choose_transition_region


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


def _tempo(track: TrackDescriptor) -> dict[str, Any]:
    return tempo_profile(track.music_map, track.window_start_ms, track.window_end_ms, track.dj_bpm)


def transition_score(a: TrackDescriptor, b: TrackDescriptor, position: float, purpose: Purpose, profile: EnergyProfile) -> dict[str, float]:
    a_tempo = _tempo(a)
    b_tempo = _tempo(b)
    a_exit = float(a_tempo["exit_bpm"])
    b_entry = float(b_tempo["entry_bpm"])
    tempo, stretch_delta = bpm_compatibility(a_exit, b_entry)
    tempo_reliability = math.sqrt(float(a_tempo["reliability"]) * float(b_tempo["reliability"]))
    constant_safe = float(bool(a_tempo["constant_stretch_safe"]) and bool(b_tempo["constant_stretch_safe"]))
    harmonic = harmonic_compatibility(a.key, b.key)
    harmonic_evidence_confidence = math.sqrt(max(0.0, a.key.confidence) * max(0.0, b.key.confidence))
    energy_target = _energy_target(position, purpose, profile)
    energy_fit = _clip01(1.0 - abs(b.energy - energy_target) / 0.65)
    flow = _clip01(1.0 - max(0.0, a.energy - b.energy - 0.18) / 0.55)
    safe_stretch = 1.0 if stretch_delta <= MAX_BEATMATCH_STRETCH else _clip01(1.0 - (stretch_delta - MAX_BEATMATCH_STRETCH) / 0.12)
    activity = transition_activity(a.music_map, a.window_end_ms, b.music_map, b.window_start_ms, 16_000)
    vocal_safety = 1.0 - float(activity["vocal_collision"])
    activity_evidence_confidence = math.sqrt(float(activity["vocal_confidence"]) * float(activity["bass_confidence"]))
    mastering_a = mastering_profile(a.music_map)
    mastering_b = mastering_profile(b.music_map)
    mastering_quality = math.sqrt(float(mastering_a["quality_score"]) * float(mastering_b["quality_score"]))
    from_boundary = transition_boundary_evidence(a.music_map, a.window_end_ms, "exit")
    to_boundary = transition_boundary_evidence(b.music_map, b.window_start_ms, "entry")
    boundary_confidence = math.sqrt(
        float(from_boundary["boundary_confidence"]) * float(to_boundary["boundary_confidence"])
    )
    boundary_suitability = math.sqrt(float(from_boundary["suitability"]) * float(to_boundary["suitability"]))
    boundary_safety = math.sqrt(max(0.0, boundary_confidence) * max(0.0, boundary_suitability))
    base_total = _clip01(
        0.25 * harmonic
        + 0.22 * tempo
        + 0.16 * energy_fit
        + 0.10 * flow
        + 0.10 * safe_stretch
        + 0.09 * tempo_reliability
        + 0.05 * vocal_safety
        + 0.03 * mastering_quality
    )
    total = _clip01(base_total * (0.88 + 0.12 * boundary_safety))
    return {
        "total": total,
        "base_total": base_total,
        "harmonic": harmonic,
        "harmonic_evidence_confidence": harmonic_evidence_confidence,
        "tempo": tempo,
        "energy_fit": energy_fit,
        "flow": flow,
        "stretch_delta": stretch_delta,
        "tempo_reliability": tempo_reliability,
        "constant_stretch_safe": constant_safe,
        "vocal_collision": float(activity["vocal_collision"]),
        "bass_collision": float(activity["bass_collision"]),
        "activity_evidence_confidence": activity_evidence_confidence,
        "mastering_quality": mastering_quality,
        "boundary_confidence": boundary_confidence,
        "boundary_suitability": boundary_suitability,
        "boundary_safety": boundary_safety,
        "a_exit_bpm": a_exit,
        "b_entry_bpm": b_entry,
    }


def _variant_transition_bonus(metrics: dict[str, float], variant: str) -> float:
    if variant == "safe":
        return (
            0.055 * metrics["boundary_safety"]
            + 0.045 * metrics["tempo_reliability"]
            + 0.03 * (1.0 - metrics["vocal_collision"])
            + 0.02 * metrics["mastering_quality"]
        )
    if variant == "adventurous":
        harmonic_contrast = _clip01(1.0 - abs(metrics["harmonic"] - 0.64) / 0.64)
        return (
            0.055 * harmonic_contrast
            + 0.025 * metrics["energy_fit"]
            + 0.02 * metrics["boundary_safety"]
        )
    return 0.0


def _candidate_legal_at_position(
    track: TrackDescriptor,
    position: int,
    locked_positions: dict[str, int],
    reserved_positions: dict[int, str],
) -> bool:
    locked = locked_positions.get(track.id)
    if locked is not None and locked != position:
        return False
    reserved_track = reserved_positions.get(position)
    return reserved_track is None or reserved_track == track.id


def order_tracks(
    tracks: list[TrackDescriptor],
    purpose: Purpose,
    profile: EnergyProfile,
    *,
    locked_positions: dict[str, int] | None = None,
    preferred_order: list[str] | None = None,
    variant: str = "recommended",
) -> list[TrackDescriptor]:
    if len(tracks) <= 2 or purpose == "journey":
        return tracks
    if variant not in {"safe", "recommended", "adventurous"}:
        raise ValueError(f"Unsupported AutoMix plan variant: {variant}")

    n = len(tracks)
    known = {track.id for track in tracks}
    locks = {
        track_id: int(position)
        for track_id, position in (locked_positions or {}).items()
        if track_id in known
    }
    if any(position < 0 or position >= n for position in locks.values()):
        raise ValueError("A locked set position is outside the selected-track range")
    if len(set(locks.values())) != len(locks):
        raise ValueError("Two tracks cannot occupy the same locked set position")
    reserved_positions = {position: track_id for track_id, position in locks.items()}
    preferred = [track_id for track_id in (preferred_order or []) if track_id in known]
    preferred.extend(track.id for track in tracks if track.id not in preferred)
    preferred_rank = {track_id: index for index, track_id in enumerate(preferred)}

    beam: list[tuple[float, tuple[int, ...]]] = []
    for index, track in enumerate(tracks):
        if not _candidate_legal_at_position(track, 0, locks, reserved_positions):
            continue
        target = _energy_target(0.0, purpose, profile)
        identity = track.window_score
        start_fit = _clip01(1.0 - abs(track.energy - target) / 0.7)
        quality = float(mastering_profile(track.music_map)["quality_score"])
        seed_bonus = 0.025 * _clip01(1.0 - preferred_rank.get(track.id, index) / max(1, n - 1))
        if variant == "safe":
            base = 0.48 * identity + 0.32 * start_fit + 0.20 * quality
        elif variant == "adventurous":
            base = 0.48 * identity + 0.44 * start_fit + 0.08 * quality
        else:
            base = 0.52 * identity + 0.38 * start_fit + 0.10 * quality
        beam.append((base + seed_bonus, (index,)))
    if not beam:
        raise ValueError("Set position locks leave no legal opening track")
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
                candidate = tracks[nxt]
                if not _candidate_legal_at_position(candidate, depth, locks, reserved_positions):
                    continue
                metrics = transition_score(last, candidate, position, purpose, profile)
                novelty = 0.025 if candidate.key.camelot != last.key.camelot else 0.0
                preferred_distance = abs(preferred_rank.get(candidate.id, depth) - depth)
                preferred_bonus = 0.035 * _clip01(1.0 - preferred_distance / max(1, n - 1))
                variant_bonus = _variant_transition_bonus(metrics, variant)
                expanded.append((
                    score + metrics["total"] + novelty + preferred_bonus + variant_bonus,
                    (*path, nxt),
                ))
        if not expanded:
            raise ValueError("Set position locks do not permit a complete legal route")
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
    tempo_safe = score["tempo_reliability"] >= 0.68 and score["constant_stretch_safe"] >= 0.5
    beatmatch = stretch_delta <= MAX_BEATMATCH_STRETCH and tempo_safe
    vocal_collision = score["vocal_collision"]
    boundary_safety = score.get("boundary_safety", 0.5)
    a_label = _section_label_near(a.music_map, a.window_end_ms)
    b_label = _section_label_near(b.music_map, b.window_start_ms)
    sparse = any(word in f"{a_label} {b_label}" for word in ("intro", "outro", "break", "bridge", "instrumental"))
    reasons: list[str] = []
    if not tempo_safe:
        beatmatch = False
        technique, bars = "echo_out", 0
        reasons.append("variable tempo evidence makes a sustained fixed-grid beatmatch unsafe")
    elif boundary_safety < 0.38:
        if beatmatch and vocal_collision < 0.34:
            technique, bars = "quick_mix", 4
            reasons.append("weak musical-boundary evidence vetoed a long blend and reduced the handoff to four bars")
        else:
            technique, bars, beatmatch = "drop_cut", 0, False
            reasons.append("weak musical-boundary evidence requires a conservative non-overlapping handoff")
    elif vocal_collision >= 0.34:
        if beatmatch:
            technique, bars = "quick_mix", 4
            reasons.append("vocal-on-vocal collision vetoed a long blend")
        else:
            technique, bars = "echo_out", 0
            reasons.append("vocal collision and tempo mismatch require a phrase-safe handoff")
    elif beatmatch and score["harmonic"] >= 0.84 and sparse and vocal_collision <= 0.18 and style != "clean" and boundary_safety >= 0.70:
        technique, bars = "harmonic_blend", 32
        reasons.append("compatible key, stable local tempo, strong boundaries and low vocal collision support a long blend")
    elif beatmatch and score["tempo"] >= 0.78 and style != "clean" and boundary_safety >= 0.52:
        technique, bars = "bass_swap", 16
        reasons.append("stable local tempo and supported musical boundaries allow a phrase transition with controlled low-end handoff")
    elif beatmatch and style == "clean":
        bars = 8 if boundary_safety >= 0.55 else 4
        technique = "quick_mix"
        reasons.append("clean locally stable beatmatched transition sized to boundary confidence")
    elif beatmatch:
        technique, bars = "quick_mix", 4
        reasons.append("beatmatch is safe but structural evidence is not strong enough for a longer blend")
    elif score["harmonic"] < 0.52 or stretch_delta > 0.10:
        technique, bars, beatmatch = "echo_out", 0, False
        reasons.append("avoids forcing an audible tempo or harmonic mismatch")
    else:
        technique, bars, beatmatch = "drop_cut", 0, False
        reasons.append("phrase-aligned cut preserves both masters without destructive stretching")
    if style == "creative" and beatmatch and technique == "bass_swap" and sparse and vocal_collision <= 0.22 and boundary_safety >= 0.62:
        technique, bars = "breakdown_swap", 16
        reasons.append("creative contrast is supported by sparse sections, structural confidence and vocal safety")
    if score["bass_collision"] >= 0.34 and technique == "harmonic_blend":
        technique, bars = "bass_swap", min(bars, 16)
        reasons.append("bass activity vetoed overlapping low-end during the harmonic blend")
    return technique, bars, beatmatch, reasons


def _apply_transition_override(
    requested: str | None,
    *,
    metrics: dict[str, float],
    canonical: tuple[str, int, bool, list[str]],
) -> tuple[str, int, bool, list[str], bool]:
    technique, bars, beatmatch, reasons = canonical
    if not requested or requested == technique:
        return technique, bars, beatmatch, reasons, bool(requested)

    tempo_safe = (
        metrics["tempo_reliability"] >= 0.68
        and metrics["constant_stretch_safe"] >= 0.5
        and metrics["stretch_delta"] <= MAX_BEATMATCH_STRETCH
    )
    if requested == "drop_cut":
        return "drop_cut", 0, False, [*reasons, "artist explicitly selected the conservative phrase-aligned cut"], True
    if requested == "echo_out":
        return "echo_out", 0, False, [*reasons, "artist explicitly selected an echo-out handoff"], True
    if requested == "quick_mix":
        if not tempo_safe:
            raise ValueError("Quick-mix override is unsafe because local tempo evidence cannot support beatmatching")
        return "quick_mix", 4, True, [*reasons, "artist explicitly selected a short beatmatched handoff"], True
    if requested == "bass_swap":
        if not tempo_safe or metrics["boundary_safety"] < 0.45 or metrics["vocal_collision"] >= 0.34:
            raise ValueError("Bass-swap override is unsafe for the measured tempo, boundary or vocal evidence")
        return "bass_swap", 16, True, [*reasons, "artist explicitly selected a controlled low-end handoff"], True
    if requested == "harmonic_blend":
        if (
            not tempo_safe
            or metrics["harmonic"] < 0.84
            or metrics["boundary_safety"] < 0.70
            or metrics["vocal_collision"] > 0.18
            or metrics["bass_collision"] >= 0.34
        ):
            raise ValueError("Harmonic-blend override is unsafe for the measured harmonic, boundary, vocal or bass evidence")
        return "harmonic_blend", 32, True, [*reasons, "artist explicitly selected a long harmonic blend"], True
    if requested == "breakdown_swap":
        if not tempo_safe or metrics["boundary_safety"] < 0.62 or metrics["vocal_collision"] > 0.22:
            raise ValueError("Breakdown-swap override is unsafe for the measured tempo, boundary or vocal evidence")
        return "breakdown_swap", 16, True, [*reasons, "artist explicitly selected a breakdown handoff"], True
    raise ValueError(f"Unsupported transition override technique: {requested}")


def _transition_confidence(metrics: dict[str, float]) -> float:
    return _clip01(
        0.27 * metrics["tempo_reliability"]
        + 0.25 * metrics["boundary_safety"]
        + 0.16 * metrics["activity_evidence_confidence"]
        + 0.12 * metrics["harmonic_evidence_confidence"]
        + 0.10 * metrics["mastering_quality"]
        + 0.10 * metrics["total"]
    )


def _transition_risk_flags(metrics: dict[str, float]) -> list[str]:
    flags: list[str] = []
    if metrics["boundary_safety"] < 0.45: flags.append("weak_boundary_evidence")
    if metrics["tempo_reliability"] < 0.68: flags.append("tempo_unreliable")
    if metrics["stretch_delta"] > MAX_BEATMATCH_STRETCH: flags.append("beatmatch_stretch_exceeds_limit")
    if metrics["vocal_collision"] >= 0.34: flags.append("vocal_collision")
    if metrics["bass_collision"] >= 0.34: flags.append("bass_collision")
    if metrics["harmonic"] < 0.52: flags.append("harmonic_tension")
    if metrics["harmonic_evidence_confidence"] < 0.45: flags.append("key_evidence_uncertain")
    if metrics["activity_evidence_confidence"] < 0.45: flags.append("activity_evidence_sparse")
    if metrics["mastering_quality"] < 0.58: flags.append("source_master_review")
    return flags


def _safe_fallback(metrics: dict[str, float], beatmatch: bool) -> tuple[str, int]:
    if metrics["tempo_reliability"] < 0.68 or metrics["stretch_delta"] > MAX_BEATMATCH_STRETCH:
        return "echo_out", 0
    if beatmatch and metrics["boundary_safety"] >= 0.45:
        return "quick_mix", 4
    return "drop_cut", 0


def _cluster_playback_bpms(ordered: list[TrackDescriptor], transitions: list[dict[str, Any]], tempos: list[dict[str, Any]]) -> list[float]:
    targets = [float(item["window_bpm"]) for item in tempos]
    index = 0
    while index < len(ordered):
        end = index
        while end < len(transitions) and bool(transitions[end].get("beatmatch")):
            end += 1
        cluster_tempos = tempos[index:end + 1]
        if len(cluster_tempos) > 1 and all(bool(item["constant_stretch_safe"]) for item in cluster_tempos):
            cluster_target = float(np.median([float(item["window_bpm"]) for item in cluster_tempos]))
            if all(abs(cluster_target / max(1e-6, float(item["window_bpm"])) - 1.0) <= MAX_BEATMATCH_STRETCH for item in cluster_tempos):
                for offset in range(index, end + 1):
                    targets[offset] = cluster_target
        index = max(index + 1, end + 1)
    return targets


def _quality_summary(transitions: list[dict[str, Any]]) -> dict[str, Any]:
    if not transitions:
        return {"transition_count": 0, "mean_score": 1.0, "mean_confidence": 1.0, "minimum_confidence": 1.0, "risky_transition_count": 0, "risk_flags": {}}
    scores = [float(item.get("score") or 0.0) for item in transitions]
    confidences = [float(item.get("confidence") or 0.0) for item in transitions]
    flags = Counter(flag for item in transitions for flag in item.get("risk_flags") or [] if isinstance(flag, str))
    return {
        "transition_count": len(transitions),
        "mean_score": round(float(np.mean(scores)), 4),
        "mean_confidence": round(float(np.mean(confidences)), 4),
        "minimum_confidence": round(min(confidences), 4),
        "risky_transition_count": sum(1 for item in transitions if item.get("risk_flags")),
        "risk_flags": dict(sorted(flags.items())),
    }


def _safe_region_descriptor(track: TrackDescriptor, *, entry_ms: int | None = None, exit_ms: int | None = None) -> TrackDescriptor:
    start = track.window_start_ms if entry_ms is None else max(track.window_start_ms, min(entry_ms, track.window_end_ms))
    end = track.window_end_ms if exit_ms is None else min(track.window_end_ms, max(exit_ms, track.window_start_ms))
    if end - start < MIN_TRACK_WINDOW_MS:
        return track
    return replace(track, window_start_ms=start, window_end_ms=end)


def build_plan(
    tracks: list[TrackDescriptor],
    purpose: Purpose,
    profile: EnergyProfile,
    style: TransitionStyle,
    target_duration_ms: int,
    *,
    locked_positions: dict[str, int] | None = None,
    preferred_order: list[str] | None = None,
    variant: str = "recommended",
    transition_overrides: dict[tuple[str, str], str] | None = None,
) -> dict[str, Any]:
    ordered = order_tracks(
        tracks,
        purpose,
        profile,
        locked_positions=locked_positions,
        preferred_order=preferred_order,
        variant=variant,
    )
    transition_override_values = transition_overrides or {}
    transitions: list[dict[str, Any]] = []
    for index, (a, b) in enumerate(zip(ordered[:-1], ordered[1:])):
        from_region = choose_transition_region(a.music_map, a.window_end_ms, "exit")
        to_region = choose_transition_region(b.music_map, b.window_start_ms, "entry")
        a_eval = _safe_region_descriptor(a, exit_ms=int(from_region["ms"]))
        b_eval = _safe_region_descriptor(b, entry_ms=int(to_region["ms"]))
        if a_eval.window_end_ms == a.window_end_ms:
            from_region = {**from_region, "ms": a.window_end_ms, "fallback_to_window_edge": True}
        if b_eval.window_start_ms == b.window_start_ms:
            to_region = {**to_region, "ms": b.window_start_ms, "fallback_to_window_edge": True}
        metrics = transition_score(a_eval, b_eval, (index + 1) / max(1, len(ordered) - 1), purpose, profile)
        requested_override = transition_override_values.get((a.id, b.id))
        technique, bars, beatmatch, reasons, user_override = _apply_transition_override(
            requested_override,
            metrics=metrics,
            canonical=choose_transition(a_eval, b_eval, metrics, style),
        )
        from_boundary = transition_boundary_evidence(a.music_map, int(from_region["ms"]), "exit")
        to_boundary = transition_boundary_evidence(b.music_map, int(to_region["ms"]), "entry")
        fallback_technique, fallback_bars = _safe_fallback(metrics, beatmatch)
        transitions.append({
            "from_track_id": a.id,
            "to_track_id": b.id,
            "technique": technique,
            "bars": bars,
            "beatmatch": beatmatch,
            "score": round(metrics["total"], 4),
            "confidence": round(_transition_confidence(metrics), 4),
            "metrics": {key: round(value, 4) for key, value in metrics.items()},
            "risk_flags": _transition_risk_flags(metrics),
            "fallback": {"technique": fallback_technique, "bars": fallback_bars},
            "mix_points": {"from_ms": int(from_region["ms"]), "to_ms": int(to_region["ms"])},
            "regions": {"from": from_region, "to": to_region},
            "evidence": {
                "from_boundary": from_boundary,
                "to_boundary": to_boundary,
                "boundary_confidence": round(metrics["boundary_confidence"], 4),
                "boundary_suitability": round(metrics["boundary_suitability"], 4),
                "boundary_safety": round(metrics["boundary_safety"], 4),
                "tempo_reliability": round(metrics["tempo_reliability"], 4),
                "activity_evidence_confidence": round(metrics["activity_evidence_confidence"], 4),
                "harmonic_evidence_confidence": round(metrics["harmonic_evidence_confidence"], 4),
            },
            "reasons": reasons,
            "user_override": user_override,
            "requested_technique": requested_override,
        })

    effective: list[TrackDescriptor] = []
    for index, track in enumerate(ordered):
        entry = int(transitions[index - 1]["mix_points"]["to_ms"]) if index > 0 else track.window_start_ms
        exit_ = int(transitions[index]["mix_points"]["from_ms"]) if index < len(transitions) else track.window_end_ms
        effective.append(_safe_region_descriptor(track, entry_ms=entry, exit_ms=exit_))

    tempos = [_tempo(track) for track in effective]
    playback_bpms = _cluster_playback_bpms(effective, transitions, tempos)
    timeline_tracks: list[dict[str, Any]] = []
    for index, track in enumerate(effective):
        tempo = tempos[index]
        source_window_bpm = float(tempo["window_bpm"])
        playback_bpm = playback_bpms[index]
        factor = playback_bpm / max(1e-6, source_window_bpm) if bool(tempo["constant_stretch_safe"]) else 1.0
        mastering = mastering_profile(track.music_map)
        timeline_tracks.append({
            "track_id": track.id,
            "title": track.title,
            "source_start_ms": track.window_start_ms,
            "source_end_ms": track.window_end_ms,
            "source_bpm": round(track.bpm, 4),
            "dj_bpm": round(track.dj_bpm, 4),
            "playback_bpm": round(playback_bpm, 4),
            "time_factor": round(factor, 7),
            "tempo": tempo,
            "mastering": mastering,
            "key": {"label": track.key.label, "camelot": track.key.camelot, "confidence": round(track.key.confidence, 4)},
            "energy": round(track.energy, 4),
            "window_score": round(track.window_score, 4),
            "region_adjusted": track.window_start_ms != ordered[index].window_start_ms or track.window_end_ms != ordered[index].window_end_ms,
            "position_locked": locked_positions is not None and track.id in locked_positions,
        })

    for index, transition in enumerate(transitions):
        a = effective[index]
        b = effective[index + 1]
        if transition["beatmatch"]:
            bpm = playback_bpms[index]
            beat_ms = 60_000.0 / max(1.0, bpm)
            requested = int(round(transition["bars"] * 4 * beat_ms))
            max_a = int((a.window_end_ms - a.window_start_ms) * 0.42)
            max_b = int((b.window_end_ms - b.window_start_ms) * 0.42)
            overlap = max(0, min(requested, max_a, max_b))
            if overlap < int(round(4 * beat_ms)):
                if transition.get("user_override"):
                    raise ValueError("The requested transition override does not fit the available phrase-aware source windows")
                transition["technique"] = "drop_cut"
                transition["beatmatch"] = False
                transition["bars"] = 0
                overlap = 0
                transition["reasons"].append("available phrase-aware transition region was too short for a safe blend")
                if "insufficient_blend_window" not in transition["risk_flags"]:
                    transition["risk_flags"].append("insufficient_blend_window")
        elif transition["technique"] == "echo_out":
            overlap = 1800
        else:
            overlap = 0
        transition["overlap_ms"] = overlap
        activity = transition_activity(a.music_map, a.window_end_ms, b.music_map, b.window_start_ms, overlap)
        transition["activity"] = activity
        transition["evidence"]["activity"] = activity

    estimated = sum(
        int(round((item["source_end_ms"] - item["source_start_ms"]) / max(1e-6, float(item["time_factor"]))))
        for item in timeline_tracks
    ) - sum(int(item.get("overlap_ms") or 0) for item in transitions)
    return {
        "version": AUTOMIX_VERSION,
        "purpose": purpose,
        "energy_profile": profile,
        "transition_style": style,
        "requested_duration_ms": target_duration_ms,
        "estimated_duration_ms": max(0, estimated),
        "tracks": timeline_tracks,
        "transitions": transitions,
        "quality_summary": _quality_summary(transitions),
        "plan_variant": variant,
        "quality_contract": {
            "max_beatmatch_stretch_percent": int(MAX_BEATMATCH_STRETCH * 100),
            "pitch_shift_semitones": 0,
            "master_preservation": True,
            "phrase_aligned": True,
            "harmonic_ordering": True,
            "vocal_collision_veto": True,
            "low_end_collision_control": True,
            "variable_tempo_aware": True,
            "unstable_tempo_never_forced_to_grid": True,
            "boundary_confidence_aware": True,
            "structured_transition_risk": True,
            "safe_transition_fallbacks": True,
            "phrase_aware_transition_regions": True,
            "hook_protection": True,
            "position_lock_constraints": bool(locked_positions),
            "transition_overrides_fail_closed": True,
        },
    }