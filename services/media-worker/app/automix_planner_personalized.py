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
from .automix_plan_directives import (
    locked_position_map,
    locked_track_ids,
    normalize_plan_directives,
    transition_override_map,
)
from .automix_planner import build_plan as build_canonical_plan
from .automix_set_intelligence import preferred_transition_style, select_tracks_for_set


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


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
