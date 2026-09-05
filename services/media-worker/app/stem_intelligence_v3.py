from __future__ import annotations

from pathlib import Path
from typing import Any

from .audio_intelligence_providers import provider_capabilities, run_basic_pitch_stem
from .stem_intelligence import analyze_stem as analyze_stem_v2

ANALYSIS_VERSION = 3


def _arrangement_events(activity_curve: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    previous_active = False
    previous_energy = 0.0
    for row in activity_curve:
        if not isinstance(row, dict):
            continue
        start = int(row.get("start_ms") or 0)
        active = bool(row.get("active"))
        energy = float(row.get("energy") or 0.0)
        rhythmic = float(row.get("rhythmic_activity") or 0.0)
        if active and not previous_active:
            events.append({
                "at_ms": start,
                "kind": "entry",
                "strength": round(max(0.0, min(1.0, energy * 0.7 + rhythmic * 0.3)), 4),
            })
        elif previous_active and not active:
            events.append({
                "at_ms": start,
                "kind": "exit",
                "strength": round(max(0.0, min(1.0, previous_energy)), 4),
            })
        elif active and energy - previous_energy >= 0.26:
            events.append({
                "at_ms": start,
                "kind": "lift",
                "strength": round(max(0.0, min(1.0, energy - previous_energy + 0.35)), 4),
            })
        previous_active = active
        previous_energy = energy
    return events[:80]


def _section_arrangement(section_activity: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    previous: dict[str, Any] | None = None
    for section in section_activity:
        if not isinstance(section, dict):
            continue
        current_energy = float(section.get("energy") or 0.0)
        current_active = float(section.get("active_ratio") or 0.0)
        if previous is not None:
            energy_delta = current_energy - float(previous.get("energy") or 0.0)
            activity_delta = current_active - float(previous.get("active_ratio") or 0.0)
            if abs(energy_delta) >= 0.18 or abs(activity_delta) >= 0.22:
                result.append({
                    "at_ms": int(section.get("start_ms") or 0),
                    "section_id": section.get("section_id"),
                    "kind": "section_lift" if energy_delta + activity_delta > 0 else "section_release",
                    "energy_delta": round(energy_delta, 4),
                    "activity_delta": round(activity_delta, 4),
                    "strength": round(max(0.0, min(1.0, abs(energy_delta) * 0.55 + abs(activity_delta) * 0.45)), 4),
                })
        previous = section
    return result[:40]


def analyze_stem(
    stem_path: Path,
    master_path: Path,
    category: str,
    sections: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    result = analyze_stem_v2(stem_path, master_path, category, sections)
    category_lower = category.lower()
    activity_curve = [row for row in result.get("activity_curve") or [] if isinstance(row, dict)]
    section_activity = [row for row in result.get("section_activity") or [] if isinstance(row, dict)]
    note_intelligence = run_basic_pitch_stem(stem_path, category_lower)

    result["version"] = ANALYSIS_VERSION
    result["engine"] = "atlas_stem_intelligence_v3"
    result["arrangement_evidence"] = {
        "events": _arrangement_events(activity_curve),
        "section_transitions": _section_arrangement(section_activity),
        "canonical_clock": "master_audio",
        "purpose": "Feed stem entry, exit, lift and release evidence into creative timeline fusion.",
    }
    result["note_intelligence"] = note_intelligence
    result["provider_capabilities"] = provider_capabilities()
    provenance = dict(result.get("provenance") or {})
    provenance.update({
        "derived_metrics": "atlas_stem_intelligence_v3",
        "arrangement_evidence": "activity_curve_and_track_sections",
        "note_intelligence": note_intelligence.get("provider") if note_intelligence.get("status") == "completed" else None,
    })
    result["provenance"] = provenance
    return result
