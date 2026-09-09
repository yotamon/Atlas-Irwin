from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .automix_model import TrackDescriptor, _clip01


@dataclass(frozen=True)
class SetIntent:
    required_track_ids: tuple[str, ...] = ()
    excluded_track_ids: tuple[str, ...] = ()
    fixed_order: tuple[str, ...] = ()
    anchor_positions: tuple[tuple[str, float], ...] = ()
    preserve_input_order: bool = False
    max_tracks: int | None = None
    bpm_min: float | None = None
    bpm_max: float | None = None
    energy_curve: tuple[tuple[float, float], ...] = ()
    harmonic_preference: float = 0.65
    vocal_density_preference: float | None = None


def _strings(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(dict.fromkeys(str(item) for item in value if isinstance(item, str) and item))


def _float(value: Any) -> float | None:
    try:
        parsed = float(value)
        return parsed if parsed == parsed else None
    except (TypeError, ValueError):
        return None


def parse_set_intent(raw: Any, available_track_ids: list[str], *, preserve_input_order_default: bool = False) -> SetIntent:
    data = raw if isinstance(raw, dict) else {}
    available = set(available_track_ids)
    required = tuple(track_id for track_id in _strings(data.get("required_track_ids")) if track_id in available)
    excluded = tuple(track_id for track_id in _strings(data.get("excluded_track_ids")) if track_id in available and track_id not in required)
    fixed_order = tuple(track_id for track_id in _strings(data.get("fixed_order")) if track_id in available and track_id not in excluded)

    anchors: list[tuple[str, float]] = []
    anchor_raw = data.get("anchor_positions")
    if isinstance(anchor_raw, dict):
        for track_id, raw_position in anchor_raw.items():
            if track_id not in available or track_id in excluded:
                continue
            position = _float(raw_position)
            if position is not None:
                anchors.append((track_id, _clip01(position)))

    curve: list[tuple[float, float]] = []
    raw_curve = data.get("energy_curve")
    if isinstance(raw_curve, list):
        for point in raw_curve:
            if not isinstance(point, dict):
                continue
            at, value = _float(point.get("at")), _float(point.get("value"))
            if at is not None and value is not None:
                curve.append((_clip01(at), _clip01(value)))
        curve.sort(key=lambda pair: pair[0])

    max_tracks = data.get("max_tracks")
    parsed_max = int(max_tracks) if isinstance(max_tracks, int) and not isinstance(max_tracks, bool) else None
    if parsed_max is not None:
        parsed_max = max(len(required), min(len(available_track_ids), max(2, parsed_max)))

    bpm_min, bpm_max = _float(data.get("bpm_min")), _float(data.get("bpm_max"))
    if bpm_min is not None and bpm_max is not None and bpm_min > bpm_max:
        bpm_min, bpm_max = bpm_max, bpm_min
    harmonic = _float(data.get("harmonic_preference"))
    vocal = _float(data.get("vocal_density_preference"))
    return SetIntent(
        required_track_ids=required,
        excluded_track_ids=excluded,
        fixed_order=fixed_order,
        anchor_positions=tuple(anchors),
        preserve_input_order=bool(data.get("preserve_input_order", preserve_input_order_default)),
        max_tracks=parsed_max,
        bpm_min=bpm_min,
        bpm_max=bpm_max,
        energy_curve=tuple(curve),
        harmonic_preference=_clip01(harmonic if harmonic is not None else 0.65),
        vocal_density_preference=_clip01(vocal) if vocal is not None else None,
    )


def energy_target(intent: SetIntent, position: float, fallback: float) -> float:
    if not intent.energy_curve:
        return _clip01(fallback)
    x = _clip01(position)
    points = intent.energy_curve
    if x <= points[0][0]:
        return points[0][1]
    if x >= points[-1][0]:
        return points[-1][1]
    for (left_x, left_y), (right_x, right_y) in zip(points[:-1], points[1:]):
        if left_x <= x <= right_x:
            amount = (x - left_x) / max(1e-9, right_x - left_x)
            return _clip01(left_y + (right_y - left_y) * amount)
    return _clip01(fallback)


def _bpm_fit(track: TrackDescriptor, intent: SetIntent) -> float:
    bpm = float(track.dj_bpm)
    if intent.bpm_min is not None and bpm < intent.bpm_min:
        return _clip01(1.0 - (intent.bpm_min - bpm) / 28.0)
    if intent.bpm_max is not None and bpm > intent.bpm_max:
        return _clip01(1.0 - (bpm - intent.bpm_max) / 28.0)
    return 1.0


def _fixed_rank_allowed(path: tuple[int, ...], candidate: int, tracks: list[TrackDescriptor], rank: dict[str, int]) -> bool:
    candidate_rank = rank.get(tracks[candidate].id)
    if candidate_rank is None:
        return True
    used_ranks = [rank[tracks[index].id] for index in path if tracks[index].id in rank]
    return not used_ranks or candidate_rank > max(used_ranks)


def _anchor_fit(track_id: str, position: float, anchors: dict[str, float]) -> float:
    target = anchors.get(track_id)
    if target is None:
        return 0.5
    return _clip01(1.0 - abs(position - target) / 0.45)


PairScore = Callable[[TrackDescriptor, TrackDescriptor, float], float]
EnergyFallback = Callable[[float], float]


def global_sequence(
    tracks: list[TrackDescriptor],
    intent: SetIntent,
    pair_score: PairScore,
    fallback_energy_target: EnergyFallback,
    *,
    beam_width: int = 192,
) -> list[TrackDescriptor]:
    excluded = set(intent.excluded_track_ids)
    candidates = [track for track in tracks if track.id not in excluded]
    if len(candidates) <= 1:
        return candidates
    required = set(intent.required_track_ids)
    available = {track.id for track in candidates}
    missing = required - available
    if missing:
        raise ValueError(f"SetIntent required tracks are unavailable: {', '.join(sorted(missing))}")
    if intent.preserve_input_order:
        return candidates[: intent.max_tracks or len(candidates)]

    target_count = min(len(candidates), intent.max_tracks or len(candidates))
    if target_count < len(required):
        raise ValueError("SetIntent max_tracks is smaller than the required track set")
    anchors = dict(intent.anchor_positions)
    fixed_rank = {track_id: index for index, track_id in enumerate(intent.fixed_order)}

    beam: list[tuple[float, tuple[int, ...]]] = []
    for index, track in enumerate(candidates):
        position = 0.0
        target_energy = energy_target(intent, position, fallback_energy_target(position))
        energy_fit = _clip01(1.0 - abs(track.energy - target_energy) / 0.68)
        anchor_fit = _anchor_fit(track.id, position, anchors)
        required_bonus = 0.08 if track.id in required else 0.0
        score = 0.42 * track.window_score + 0.30 * energy_fit + 0.18 * _bpm_fit(track, intent) + 0.10 * anchor_fit + required_bonus
        beam.append((score, (index,)))
    beam.sort(reverse=True, key=lambda item: item[0])
    beam = beam[: min(32, len(beam))]

    for depth in range(1, target_count):
        position = depth / max(1, target_count - 1)
        expanded: list[tuple[float, tuple[int, ...]]] = []
        for score, path in beam:
            used = set(path)
            last = candidates[path[-1]]
            for nxt, track in enumerate(candidates):
                if nxt in used or not _fixed_rank_allowed(path, nxt, candidates, fixed_rank):
                    continue
                target_energy = energy_target(intent, position, fallback_energy_target(position))
                energy_fit = _clip01(1.0 - abs(track.energy - target_energy) / 0.68)
                anchor_fit = _anchor_fit(track.id, position, anchors)
                required_bonus = 0.08 if track.id in required else 0.0
                transition = _clip01(pair_score(last, track, position))
                candidate_score = (
                    0.52 * transition
                    + 0.19 * energy_fit
                    + 0.12 * _bpm_fit(track, intent)
                    + 0.09 * track.window_score
                    + 0.08 * anchor_fit
                    + required_bonus
                )
                expanded.append((score + candidate_score, (*path, nxt)))
        expanded.sort(reverse=True, key=lambda item: item[0])
        beam = expanded[:beam_width]
        if not beam:
            break

    complete = [item for item in beam if len(item[1]) == target_count and required.issubset({candidates[i].id for i in item[1]})]
    if not complete:
        raise ValueError("SetIntent constraints could not produce a complete set sequence")
    best = max(complete, key=lambda item: item[0])
    return [candidates[index] for index in best[1]]


def intent_summary(intent: SetIntent) -> dict[str, Any]:
    return {
        "required_track_ids": list(intent.required_track_ids),
        "excluded_track_ids": list(intent.excluded_track_ids),
        "fixed_order": list(intent.fixed_order),
        "anchor_positions": dict(intent.anchor_positions),
        "preserve_input_order": intent.preserve_input_order,
        "max_tracks": intent.max_tracks,
        "bpm_min": intent.bpm_min,
        "bpm_max": intent.bpm_max,
        "energy_curve": [{"at": at, "value": value} for at, value in intent.energy_curve],
        "harmonic_preference": intent.harmonic_preference,
        "vocal_density_preference": intent.vocal_density_preference,
    }
