from __future__ import annotations

from typing import Any

from .automix_model import EnergyProfile, Purpose, TrackDescriptor, TransitionStyle
from .automix_planner import build_plan as build_canonical_plan
from .automix_set_intelligence import preferred_transition_style, select_tracks_for_set


def build_set_intelligent_plan(
    tracks: list[TrackDescriptor],
    purpose: Purpose,
    profile: EnergyProfile,
    style: TransitionStyle,
    target_duration_ms: int,
    *,
    set_intent: Any = None,
    dj_profile: Any = None,
) -> dict[str, Any]:
    """Curate the candidate pool, then delegate all sequencing/transition safety to AutoMix."""

    selection = select_tracks_for_set(
        tracks,
        purpose=purpose,
        energy_profile=profile,
        target_duration_ms=target_duration_ms,
        set_intent=set_intent,
        dj_profile=dj_profile,
    )
    normalized_profile = selection["dj_profile"]
    effective_style = preferred_transition_style(style, normalized_profile)
    plan = build_canonical_plan(
        selection["tracks"],
        purpose,
        profile,
        effective_style,
        target_duration_ms,
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
    plan["requested_transition_style"] = style
    plan["effective_transition_style"] = effective_style
    plan["quality_contract"] = {
        **(plan.get("quality_contract") or {}),
        "duration_aware_candidate_curation": True,
        "personalization_is_bounded": True,
        "canonical_transition_safety_preserved": True,
        "set_intent_version": selection["set_intent"].get("version"),
        "dj_profile_version": normalized_profile.get("version"),
    }
    return plan
