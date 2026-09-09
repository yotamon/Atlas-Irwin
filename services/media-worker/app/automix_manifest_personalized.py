from __future__ import annotations

from typing import Any

from .automix_manifest import build_mixplan as build_canonical_mixplan, mixplan_hash, validate_mixplan


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _records(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def build_mixplan(plan: dict[str, Any], *, source_fingerprints: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Extend MixPlan v2 with planning provenance without changing the render contract."""
    manifest = build_canonical_mixplan(plan, source_fingerprints=source_fingerprints)
    manifest.update({
        "set_intent": _record(plan.get("set_intent")),
        "selection_summary": _record(plan.get("selection_summary")),
        "omitted_tracks": _records(plan.get("omitted_tracks")),
        "dj_profile": _record(plan.get("dj_profile")),
        "requested_transition_style": plan.get("requested_transition_style"),
        "effective_transition_style": plan.get("effective_transition_style"),
    })
    manifest["plan_hash"] = mixplan_hash(manifest)
    validate_mixplan(manifest)
    return manifest
