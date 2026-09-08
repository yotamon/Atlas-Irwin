from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from .audio_intelligence_providers import (
    provider_capabilities,
    run_beat_this_shadow,
    run_clap_audio_semantics,
)
from .mastering_inspector import enrich_music_map_with_mastering
from .music_intelligence_v4 import analyze_music as analyze_music_v4_core
from .strongest_moments import attach_strongest_moments


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


def _semantic_windows(result: dict[str, Any]) -> list[dict[str, Any]]:
    moments = result.get("musical_moments") or result.get("hook_candidates") or []
    windows: list[dict[str, Any]] = []
    for moment in moments:
        if not isinstance(moment, dict):
            continue
        start_ms = int(moment.get("start_ms") or 0)
        end_ms = int(moment.get("end_ms") or 0)
        if end_ms - start_ms < 1000:
            continue
        windows.append({
            "id": str(moment.get("id") or f"moment-{start_ms}-{end_ms}"),
            "start_ms": start_ms,
            "end_ms": end_ms,
        })
        if len(windows) >= 5:
            break
    return windows


def _attach_cross_modal_semantics(result: dict[str, Any], path: Path) -> None:
    semantic = run_clap_audio_semantics(path, _semantic_windows(result))
    result["semantic_intelligence"] = semantic

    analysis = result.setdefault("analysis", {})
    semantic_status = {
        key: semantic.get(key)
        for key in ("status", "provider", "model", "revision", "embedding_dim", "reason")
        if semantic.get(key) is not None
    }
    analysis["semantic_intelligence"] = semantic_status

    if semantic.get("status") != "completed":
        return

    by_id = {
        str(item.get("id")): item
        for item in semantic.get("items") or []
        if isinstance(item, dict) and item.get("id") is not None
    }
    for collection_name in ("musical_moments", "hook_candidates"):
        for moment in result.get(collection_name) or []:
            if not isinstance(moment, dict):
                continue
            item = by_id.get(str(moment.get("id")))
            if not item:
                continue
            # Consumers normally need explainable descriptors. Full normalized vectors stay
            # in semantic_intelligence so the moment payload itself remains compact.
            moment["semantic_descriptors"] = item.get("descriptors") or []
            moment["semantic_embedding_ref"] = {
                "provider": semantic.get("provider"),
                "model": semantic.get("model"),
                "revision": semantic.get("revision"),
                "window_id": item.get("id"),
            }

    tiers = result.setdefault("analysis_tiers", {})
    semantic_tier = tiers.setdefault("semantic", {"status": "completed", "includes": []})
    includes = semantic_tier.setdefault("includes", [])
    if "clap_moment_semantics" not in includes:
        includes.append("clap_moment_semantics")


def analyze_music(path: Path, source_audio: dict[str, Any] | None = None) -> dict[str, Any]:
    result = analyze_music_v4_core(path, source_audio)
    _compatibility_enrich(result)
    attach_strongest_moments(result)
    capabilities = provider_capabilities()
    result["provider_capabilities"] = capabilities
    analysis = result.setdefault("analysis", {})
    analysis["provider_capabilities"] = capabilities
    _attach_shadow_rhythm(result, path)
    _attach_cross_modal_semantics(result, path)

    # Mastering Inspector runs after the canonical musical grid exists so beat stability
    # can distinguish drift/jitter from section-aligned tempo changes. It enriches the
    # same v4 payload rather than creating a second source of truth.
    enrich_music_map_with_mastering(result, path)
    analysis_tiers = result.setdefault("analysis_tiers", {})
    deep = analysis_tiers.setdefault("deep", {"status": "completed", "includes": []})
    includes = deep.setdefault("includes", [])
    for capability in ("mastering_inspector", "beat_stability", "codec_stress"):
        if capability not in includes:
            includes.append(capability)
    return result
