from __future__ import annotations

import math
from typing import Any

import numpy as np

from .automix_intelligence import mastering_profile
from .automix_model import (
    EnergyProfile,
    Purpose,
    TrackDescriptor,
    TransitionStyle,
    _clip01,
    bpm_compatibility,
    harmonic_compatibility,
)

SET_INTENT_VERSION = "ensemblis.set-intent.v1"
DJ_PROFILE_VERSION = "ensemblis.dj-profile.v1"


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _string_ids(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        if isinstance(item, str) and item and item not in result:
            result.append(item)
    return result


def _number(value: Any, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


def normalize_dj_profile(value: Any) -> dict[str, Any]:
    raw = _record(value)
    enabled = bool(raw.get("enabled", True))
    learned_confidence = _clip01(_number(raw.get("learned_confidence"), 0.0))
    return {
        "version": DJ_PROFILE_VERSION,
        "enabled": enabled,
        "harmonic_adventure": _clip01(_number(raw.get("harmonic_adventure"), 0.50)),
        "transition_aggressiveness": _clip01(_number(raw.get("transition_aggressiveness"), 0.50)),
        "exploration": _clip01(_number(raw.get("exploration"), 0.45)),
        "learned_confidence": learned_confidence,
    }


def normalize_set_intent(
    value: Any,
    *,
    purpose: Purpose,
    target_duration_ms: int,
    tracks: list[TrackDescriptor],
) -> dict[str, Any]:
    raw = _record(value)
    known_ids = {track.id for track in tracks}
    must_play = [track_id for track_id in _string_ids(raw.get("must_play_track_ids")) if track_id in known_ids]
    blocked = [track_id for track_id in _string_ids(raw.get("blocked_track_ids")) if track_id in known_ids]
    min_bpm_raw = raw.get("min_bpm")
    max_bpm_raw = raw.get("max_bpm")
    min_bpm = _number(min_bpm_raw, 0.0) if min_bpm_raw is not None else None
    max_bpm = _number(max_bpm_raw, 0.0) if max_bpm_raw is not None else None
    if min_bpm is not None and min_bpm <= 0:
        min_bpm = None
    if max_bpm is not None and max_bpm <= 0:
        max_bpm = None
    if min_bpm is not None and max_bpm is not None and min_bpm > max_bpm:
        min_bpm, max_bpm = max_bpm, min_bpm

    explicit_target = raw.get("target_track_count")
    target_track_count = None
    if isinstance(explicit_target, (int, float)) and math.isfinite(float(explicit_target)):
        target_track_count = max(2, min(len(tracks), int(round(float(explicit_target)))))

    allow_omissions = bool(raw.get("allow_omissions", purpose != "journey"))
    if purpose == "journey" and "allow_omissions" not in raw:
        allow_omissions = False

    return {
        "version": SET_INTENT_VERSION,
        "purpose": purpose,
        "target_duration_ms": target_duration_ms,
        "allow_omissions": allow_omissions,
        "must_play_track_ids": must_play,
        "blocked_track_ids": blocked,
        "min_bpm": round(min_bpm, 3) if min_bpm is not None else None,
        "max_bpm": round(max_bpm, 3) if max_bpm is not None else None,
        "target_track_count": target_track_count,
    }


def preferred_transition_style(style: TransitionStyle, profile: dict[str, Any]) -> TransitionStyle:
    if not profile.get("enabled", True) or style != "dj":
        return style
    aggressiveness = float(profile.get("transition_aggressiveness", 0.5))
    if aggressiveness <= 0.24:
        return "clean"
    if aggressiveness >= 0.80:
        return "creative"
    return style


def _purpose_energy_target(purpose: Purpose, profile: EnergyProfile) -> float:
    target = {
        "booking": 0.68,
        "soundcloud": 0.58,
        "journey": 0.56,
        "peak_time": 0.84,
        "warm_up": 0.48,
        "discovery": 0.63,
    }[purpose]
    if profile == "peak":
        target += 0.08
    elif profile == "smooth":
        target -= 0.04
    return _clip01(target)


def _ideal_track_seconds(purpose: Purpose) -> float:
    return {
        "booking": 105.0,
        "soundcloud": 135.0,
        "journey": 120.0,
        "peak_time": 100.0,
        "warm_up": 150.0,
        "discovery": 78.0,
    }[purpose]


def _base_candidate_score(track: TrackDescriptor, purpose: Purpose, profile: EnergyProfile) -> float:
    quality = float(mastering_profile(track.music_map)["quality_score"])
    target_energy = _purpose_energy_target(purpose, profile)
    energy_fit = _clip01(1.0 - abs(track.energy - target_energy) / 0.72)
    return _clip01(0.56 * track.window_score + 0.26 * energy_fit + 0.18 * quality)


def _pair_candidate_score(a: TrackDescriptor, b: TrackDescriptor, profile: dict[str, Any]) -> float:
    harmonic = harmonic_compatibility(a.key, b.key)
    tempo, delta = bpm_compatibility(a.dj_bpm, b.dj_bpm)
    adventure = float(profile.get("harmonic_adventure", 0.5)) if profile.get("enabled", True) else 0.5
    exploration = float(profile.get("exploration", 0.45)) if profile.get("enabled", True) else 0.45

    harmonic_contrast = _clip01(1.0 - abs(harmonic - 0.68) / 0.68)
    harmonic_preference = _clip01(harmonic * (1.0 - 0.34 * adventure) + harmonic_contrast * 0.34 * adventure)
    key_novelty = 1.0 if a.key.camelot != b.key.camelot else 0.0
    tempo_penalty = _clip01(1.0 - max(0.0, delta - 0.06) / 0.16)
    return _clip01(
        0.52 * harmonic_preference
        + 0.34 * tempo
        + 0.10 * tempo_penalty
        + 0.04 * exploration * key_novelty
    )


def _target_count(
    eligible_count: int,
    target_duration_ms: int,
    purpose: Purpose,
    intent: dict[str, Any],
    must_count: int,
) -> int:
    if eligible_count <= 2 or not bool(intent.get("allow_omissions")):
        return eligible_count
    explicit = intent.get("target_track_count")
    if isinstance(explicit, int):
        target = explicit
    else:
        target = int(round((target_duration_ms / 1000.0) / _ideal_track_seconds(purpose)))
    target = max(2, min(eligible_count, target))
    return max(target, must_count)


def select_tracks_for_set(
    tracks: list[TrackDescriptor],
    *,
    purpose: Purpose,
    energy_profile: EnergyProfile,
    target_duration_ms: int,
    set_intent: Any = None,
    dj_profile: Any = None,
) -> dict[str, Any]:
    if len(tracks) < 2:
        raise ValueError("Set Intelligence requires at least two candidate tracks")

    intent = normalize_set_intent(
        set_intent,
        purpose=purpose,
        target_duration_ms=target_duration_ms,
        tracks=tracks,
    )
    profile = normalize_dj_profile(dj_profile)
    must_ids = set(intent["must_play_track_ids"])
    blocked_ids = set(intent["blocked_track_ids"])
    min_bpm = intent.get("min_bpm")
    max_bpm = intent.get("max_bpm")

    if must_ids & blocked_ids:
        conflict = sorted(must_ids & blocked_ids)[0]
        raise ValueError(f"Set Intent cannot both require and block track {conflict}")

    eligible: list[TrackDescriptor] = []
    omitted: list[dict[str, Any]] = []
    for track in tracks:
        if track.id in blocked_ids:
            omitted.append({"track_id": track.id, "title": track.title, "reason": "blocked_by_set_intent"})
            continue
        if min_bpm is not None and track.dj_bpm < float(min_bpm):
            if track.id in must_ids:
                raise ValueError(f"Must-play track {track.title} is below the requested BPM range")
            omitted.append({"track_id": track.id, "title": track.title, "reason": "below_bpm_range"})
            continue
        if max_bpm is not None and track.dj_bpm > float(max_bpm):
            if track.id in must_ids:
                raise ValueError(f"Must-play track {track.title} is above the requested BPM range")
            omitted.append({"track_id": track.id, "title": track.title, "reason": "above_bpm_range"})
            continue
        eligible.append(track)

    if len(eligible) < 2:
        raise ValueError("Set Intent leaves fewer than two playable candidate tracks")
    missing_must = must_ids - {track.id for track in eligible}
    if missing_must:
        raise ValueError("A must-play track is unavailable after Set Intent constraints")

    count = _target_count(len(eligible), target_duration_ms, purpose, intent, len(must_ids))
    if count >= len(eligible):
        selected = eligible
    else:
        selected_ids: set[str] = set(must_ids)
        selected = [track for track in eligible if track.id in selected_ids]
        remaining = [track for track in eligible if track.id not in selected_ids]

        if not selected:
            seed = max(remaining, key=lambda track: _base_candidate_score(track, purpose, energy_profile))
            selected.append(seed)
            selected_ids.add(seed.id)
            remaining = [track for track in remaining if track.id != seed.id]

        while len(selected) < count and remaining:
            best_track: TrackDescriptor | None = None
            best_score = -1.0
            for candidate in remaining:
                base = _base_candidate_score(candidate, purpose, energy_profile)
                pair_scores = [_pair_candidate_score(existing, candidate, profile) for existing in selected]
                coherence = float(np.mean(pair_scores)) if pair_scores else 0.5
                quality = float(mastering_profile(candidate.music_map)["quality_score"])
                score = 0.58 * base + 0.30 * coherence + 0.12 * quality
                if score > best_score:
                    best_score = score
                    best_track = candidate
            if best_track is None:
                break
            selected.append(best_track)
            selected_ids.add(best_track.id)
            remaining = [track for track in remaining if track.id != best_track.id]

        for track in remaining:
            omitted.append({
                "track_id": track.id,
                "title": track.title,
                "reason": "duration_aware_curation",
                "candidate_score": round(_base_candidate_score(track, purpose, energy_profile), 4),
            })

    selected_id_set = {track.id for track in selected}
    selected = [track for track in tracks if track.id in selected_id_set]

    reasons: dict[str, list[str]] = {}
    for track in selected:
        track_reasons: list[str] = []
        if track.id in must_ids:
            track_reasons.append("required by Set Intent")
        if track.window_score >= 0.78:
            track_reasons.append("strong musical-identity window")
        quality = float(mastering_profile(track.music_map)["quality_score"])
        if quality >= 0.82:
            track_reasons.append("technically strong source master")
        target_energy = _purpose_energy_target(purpose, energy_profile)
        if abs(track.energy - target_energy) <= 0.16:
            track_reasons.append("supports the requested energy territory")
        if not track_reasons:
            track_reasons.append("improves the globally curated candidate route")
        reasons[track.id] = track_reasons

    return {
        "tracks": selected,
        "set_intent": intent,
        "dj_profile": profile,
        "selection_reasons": reasons,
        "omitted_tracks": omitted,
        "summary": {
            "candidate_count": len(tracks),
            "eligible_count": len(eligible),
            "selected_count": len(selected),
            "omitted_count": len(tracks) - len(selected),
            "duration_aware_curation": len(selected) < len(eligible),
            "must_play_count": len(must_ids),
            "profile_applied": bool(profile.get("enabled", True)),
        },
    }
