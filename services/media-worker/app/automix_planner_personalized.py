from __future__ import annotations

from dataclasses import replace
from typing import Any

from .automix_model import (
    MIN_TRACK_WINDOW_MS,
    EnergyProfile,
    Purpose,
    TrackDescriptor,
    TransitionStyle,
    choose_showcase_window,
)
from .automix_planner import build_plan as build_canonical_plan
from .automix_set_intelligence import preferred_transition_style, select_tracks_for_set

PLAN_DIRECTIVES_VERSION = "ensemblis.plan-directives.v1"
PLAN_VARIANTS = {"safe", "recommended", "adventurous"}
SUPPORTED_TECHNIQUES = {
    "quick_mix",
    "bass_swap",
    "harmonic_blend",
    "breakdown_swap",
    "echo_out",
    "drop_cut",
}


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _records(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _string_ids(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        if isinstance(item, str) and item and item not in result:
            result.append(item)
    return result


def normalize_plan_directives(value: Any, tracks: list[TrackDescriptor]) -> dict[str, Any]:
    raw = _record(value)
    known_ids = [track.id for track in tracks]
    known = set(known_ids)

    variant = str(raw.get("variant") or "recommended")
    if variant not in PLAN_VARIANTS:
        raise ValueError(f"Unsupported AutoMix plan variant: {variant}")

    preferred_order = _string_ids(raw.get("preferred_order_track_ids"))
    unknown_preferred = [track_id for track_id in preferred_order if track_id not in known]
    if unknown_preferred:
        raise ValueError("Plan directives contain a preferred-order track outside the candidate pool")
    preferred_order = [*preferred_order, *[track_id for track_id in known_ids if track_id not in preferred_order]]

    locked_positions: list[dict[str, Any]] = []
    locked_track_ids_seen: set[str] = set()
    locked_position_values: set[int] = set()
    for item in _records(raw.get("locked_positions")):
        track_id = str(item.get("track_id") or "")
        position = item.get("position")
        if track_id not in known:
            raise ValueError("Plan directives contain a locked track outside the candidate pool")
        if not isinstance(position, int) or isinstance(position, bool) or not 0 <= position < len(tracks):
            raise ValueError("Plan lock position is outside the candidate-pool range")
        if track_id in locked_track_ids_seen:
            raise ValueError(f"Track {track_id} is locked more than once")
        if position in locked_position_values:
            raise ValueError(f"More than one track is locked to position {position + 1}")
        locked_track_ids_seen.add(track_id)
        locked_position_values.add(position)
        locked_positions.append({"track_id": track_id, "position": position})
    locked_positions.sort(key=lambda item: int(item["position"]))

    transition_overrides: list[dict[str, str]] = []
    seen_pairs: set[tuple[str, str]] = set()
    for item in _records(raw.get("transition_overrides")):
        from_track_id = str(item.get("from_track_id") or "")
        to_track_id = str(item.get("to_track_id") or "")
        technique = str(item.get("technique") or "")
        if from_track_id not in known or to_track_id not in known or from_track_id == to_track_id:
            raise ValueError("Transition override references an invalid candidate pair")
        if technique not in SUPPORTED_TECHNIQUES:
            raise ValueError(f"Unsupported transition override technique: {technique}")
        pair = (from_track_id, to_track_id)
        if pair in seen_pairs:
            raise ValueError("A transition pair can only have one explicit override")
        seen_pairs.add(pair)
        transition_overrides.append({
            "from_track_id": from_track_id,
            "to_track_id": to_track_id,
            "technique": technique,
        })

    return {
        "version": PLAN_DIRECTIVES_VERSION,
        "variant": variant,
        "preferred_order_track_ids": preferred_order,
        "locked_positions": locked_positions,
        "transition_overrides": transition_overrides,
    }


def locked_position_map(directives: dict[str, Any]) -> dict[str, int]:
    return {
        str(item["track_id"]): int(item["position"])
        for item in _records(directives.get("locked_positions"))
    }


def locked_track_ids(directives: dict[str, Any]) -> list[str]:
    return [str(item["track_id"]) for item in _records(directives.get("locked_positions"))]


def transition_override_map(directives: dict[str, Any]) -> dict[tuple[str, str], str]:
    result: dict[tuple[str, str], str] = {}
    for item in _records(directives.get("transition_overrides")):
        pair = (str(item.get("from_track_id") or ""), str(item.get("to_track_id") or ""))
        if pair[0] and pair[1]:
            result[pair] = str(item.get("technique") or "")
    return result


def _rewindow_selected_tracks(
    tracks: list[TrackDescriptor],
    *,
    purpose: Purpose,
    target_duration_ms: int,
) -> list[TrackDescriptor]:
    """Re-size showcase windows after curation so target duration stays meaningful."""
    if not tracks:
        return []
    desired_ms = max(MIN_TRACK_WINDOW_MS, int(target_duration_ms / len(tracks)) + 16_000)
    result: list[TrackDescriptor] = []
    for track in tracks:
        start, end, window_score = choose_showcase_window(track.music_map, desired_ms, purpose)
        result.append(replace(
            track,
            window_start_ms=start,
            window_end_ms=end,
            window_score=window_score,
        ))
    return result


def _set_intent_with_directive_locks(value: Any, directives: dict[str, Any]) -> dict[str, Any]:
    """Promote position locks to selection constraints before duration-aware curation.

    A track cannot be position-locked and then disappear during candidate curation. Likewise,
    a lock on position N implies the final route must contain at least N+1 tracks. The ordinary
    Set Intent validator remains authoritative for blocked-track conflicts and hard BPM bounds.
    """
    raw = dict(_record(value))
    required_ids = locked_track_ids(directives)
    must_play = raw.get("must_play_track_ids")
    must_play_ids = [item for item in must_play if isinstance(item, str)] if isinstance(must_play, list) else []
    for track_id in required_ids:
        if track_id not in must_play_ids:
            must_play_ids.append(track_id)
    raw["must_play_track_ids"] = must_play_ids

    locks = locked_position_map(directives)
    required_count = max((position + 1 for position in locks.values()), default=0)
    requested_count = raw.get("target_track_count")
    if required_count:
        if isinstance(requested_count, (int, float)) and not isinstance(requested_count, bool):
            raw["target_track_count"] = max(required_count, int(round(float(requested_count))))
        else:
            raw["target_track_count"] = required_count
    return raw


def build_set_intelligent_plan(
    tracks: list[TrackDescriptor],
    purpose: Purpose,
    profile: EnergyProfile,
    style: TransitionStyle,
    target_duration_ms: int,
    *,
    set_intent: Any = None,
    dj_profile: Any = None,
    plan_directives: Any = None,
) -> dict[str, Any]:
    """Curate candidates, then delegate sequencing and transition safety to canonical AutoMix."""

    directives = normalize_plan_directives(plan_directives, tracks)
    effective_set_intent = _set_intent_with_directive_locks(set_intent, directives)
    selection = select_tracks_for_set(
        tracks,
        purpose=purpose,
        energy_profile=profile,
        target_duration_ms=target_duration_ms,
        set_intent=effective_set_intent,
        dj_profile=dj_profile,
    )
    normalized_profile = selection["dj_profile"]
    effective_style = preferred_transition_style(style, normalized_profile)
    selected_tracks = _rewindow_selected_tracks(
        selection["tracks"],
        purpose=purpose,
        target_duration_ms=target_duration_ms,
    )

    selected_ids = {track.id for track in selected_tracks}
    selected_locks = {
        track_id: position
        for track_id, position in locked_position_map(directives).items()
        if track_id in selected_ids
    }
    if selected_locks and max(selected_locks.values()) >= len(selected_tracks):
        raise ValueError("A locked set position is outside the final curated route")

    plan = build_canonical_plan(
        selected_tracks,
        purpose,
        profile,
        effective_style,
        target_duration_ms,
        locked_positions=selected_locks,
        preferred_order=[
            track_id
            for track_id in directives["preferred_order_track_ids"]
            if track_id in selected_ids
        ],
        variant=str(directives["variant"]),
        transition_overrides=transition_override_map(directives),
    )

    reasons = selection["selection_reasons"]
    for item in plan.get("tracks") or []:
        if not isinstance(item, dict):
            continue
        track_id = str(item.get("track_id") or "")
        item["selection_reasons"] = list(reasons.get(track_id, []))
        item["selection_source"] = "set_intelligence"

    plan["set_intent"] = selection["set_intent"]
    plan["selection_summary"] = selection["summary"]
    plan["omitted_tracks"] = selection["omitted_tracks"]
    plan["dj_profile"] = normalized_profile
    plan["plan_directives"] = directives
    plan["requested_transition_style"] = style
    plan["effective_transition_style"] = effective_style
    plan["quality_contract"] = {
        **(plan.get("quality_contract") or {}),
        "duration_aware_candidate_curation": True,
        "post_curation_window_resizing": True,
        "personalization_is_bounded": True,
        "canonical_transition_safety_preserved": True,
        "plan_directives_are_durable": True,
        "locked_tracks_survive_curation": True,
        "set_intent_version": selection["set_intent"].get("version"),
        "dj_profile_version": normalized_profile.get("version"),
        "plan_directives_version": directives.get("version"),
    }
    return plan
