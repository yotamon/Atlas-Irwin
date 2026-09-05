from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from .audio_intelligence_providers import provider_capabilities, run_beat_this_shadow
from .music_intelligence_v4 import analyze_music as analyze_music_v4_core


def _nearest_median_ms(reference: list[int], candidate: list[int]) -> float | None:
    if not reference or not candidate:
        return None
    distances = [min(abs(value - other) for other in candidate) for value in reference]
    return float(np.median(np.asarray(distances, dtype=np.float64))) if distances else None


def _agreement_from_error(error_ms: float | None, tolerance_ms: float) -> float | None:
    if error_ms is None:
        return None
    return max(0.0, min(1.0, 1.0 - error_ms / max(1.0, tolerance_ms)))


def _compatibility_enrich(result: dict[str, Any]) -> None:
    sections = {
        str(section.get("id")): section
        for section in result.get("sections") or []
        if isinstance(section, dict) and section.get("id") is not None
    }
    for candidate in result.get("hook_candidates") or []:
        if not isinstance(candidate, dict):
            continue
        metrics = candidate.get("metrics") if isinstance(candidate.get("metrics"), dict) else {}
        section = sections.get(str(candidate.get("section_id"))) or {}
        duration = max(1, int(candidate.get("end_ms") or 0) - int(candidate.get("start_ms") or 0))
        candidate.setdefault("target_duration_ms", duration)
        candidate.setdefault("section_type", section.get("type") or "section")
        candidate.setdefault("energy", float(metrics.get("energy") or 0.0))
        candidate.setdefault("energy_lift", float(metrics.get("energy_lift") or 0.0))
        candidate.setdefault("repetition", float(metrics.get("semantic_recurrence") or metrics.get("repetition") or 0.0))
        candidate.setdefault("melodic_salience", float(metrics.get("harmonic_distinctiveness") or metrics.get("melodic_salience") or 0.0))
        candidate.setdefault("rhythmic_activity", float(metrics.get("onset_density") or metrics.get("rhythmic_activity") or 0.0))


def _attach_shadow_rhythm(result: dict[str, Any], path: Path) -> None:
    shadow = run_beat_this_shadow(path)
    consensus = result.setdefault("rhythm_consensus", {})
    shadow_providers = consensus.setdefault("shadow_providers", {})
    shadow_entry = shadow_providers.setdefault("beat_this", {})
    shadow_entry.update({key: value for key, value in shadow.items() if key not in {"beats_ms", "downbeats_ms"}})

    if shadow.get("status") != "completed":
        return

    canonical_beats = [int(value) for value in result.get("beats_ms") or []]
    canonical_downbeats = [int(value) for value in result.get("downbeats_ms") or []]
    shadow_beats = [int(value) for value in shadow.get("beats_ms") or []]
    shadow_downbeats = [int(value) for value in shadow.get("downbeats_ms") or []]
    beat_error = _nearest_median_ms(canonical_beats, shadow_beats)
    downbeat_error = _nearest_median_ms(canonical_downbeats, shadow_downbeats)
    beat_agreement = _agreement_from_error(beat_error, 90.0)
    downbeat_agreement = _agreement_from_error(downbeat_error, 140.0)

    shadow_entry.update({
        "beat_count": len(shadow_beats),
        "downbeat_count": len(shadow_downbeats),
        "median_beat_error_ms": round(beat_error, 2) if beat_error is not None else None,
        "median_downbeat_error_ms": round(downbeat_error, 2) if downbeat_error is not None else None,
        "beat_agreement": round(beat_agreement, 4) if beat_agreement is not None else None,
        "downbeat_agreement": round(downbeat_agreement, 4) if downbeat_agreement is not None else None,
        "promotion_policy": "shadow_only_until_private_catalog_benchmark_passes",
    })

    scores = [value for value in (beat_agreement, downbeat_agreement) if value is not None]
    if scores:
        shadow_entry["overall_agreement"] = round(sum(scores) / len(scores), 4)


def analyze_music(path: Path, source_audio: dict[str, Any] | None = None) -> dict[str, Any]:
    result = analyze_music_v4_core(path, source_audio)
    _compatibility_enrich(result)
    capabilities = provider_capabilities()
    result["provider_capabilities"] = capabilities
    analysis = result.setdefault("analysis", {})
    analysis["provider_capabilities"] = capabilities
    _attach_shadow_rhythm(result, path)
    return result
