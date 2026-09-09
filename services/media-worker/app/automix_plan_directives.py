from __future__ import annotations

from typing import Any

from .automix_model import TrackDescriptor

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
    locked_track_ids: set[str] = set()
    locked_position_values: set[int] = set()
    for item in _records(raw.get("locked_positions")):
        track_id = str(item.get("track_id") or "")
        position = item.get("position")
        if track_id not in known:
            raise ValueError("Plan directives contain a locked track outside the candidate pool")
        if not isinstance(position, int) or isinstance(position, bool) or not 0 <= position < len(tracks):
            raise ValueError("Plan lock position is outside the candidate-pool range")
        if track_id in locked_track_ids:
            raise ValueError(f"Track {track_id} is locked more than once")
        if position in locked_position_values:
            raise ValueError(f"More than one track is locked to position {position + 1}")
        locked_track_ids.add(track_id)
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
