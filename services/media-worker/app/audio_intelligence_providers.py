from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from typing import Any


def _enabled(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _installed(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def provider_capabilities() -> dict[str, dict[str, Any]]:
    """Truthful provider registry. Availability never implies that a provider ran."""
    return {
        "beat_this": {
            "purpose": "shadow beat/downbeat tracker",
            "installed": _installed("beat_this"),
            "enabled": _enabled("ATLAS_BEAT_THIS_ENABLED"),
            "mode": "shadow",
            "license_policy": "commercial_ok_mit",
            "tier": "deep_optional",
        },
        "basic_pitch": {
            "purpose": "optional note/melody transcription for tonal stems",
            "installed": _installed("basic_pitch"),
            "enabled": _enabled("ATLAS_BASIC_PITCH_ENABLED"),
            "mode": "stem_only",
            "runtime_supported": sys.version_info < (3, 12),
            "tier": "on_demand_external_profile",
        },
        "mert": {
            "purpose": "experimental music representation benchmark",
            "installed": False,
            "enabled": False,
            "mode": "research_only",
            "license_policy": "blocked_for_commercial_default_weights",
            "tier": "research_only",
            "note": "MERT-v1-95M default Hugging Face weights are CC-BY-NC-4.0; Ensemblis keeps All-In-One embeddings as the commercial canonical representation.",
        },
        "singing_forced_alignment": {
            "purpose": "known-lyrics to isolated-vocal phoneme/word alignment",
            "installed": False,
            "enabled": False,
            "mode": "external_adapter",
            "tier": "deep_optional",
            "note": "The in-process fallback remains vocal-activity alignment. Singing-specific aligners require an isolated runtime/model/language dictionary and must not silently replace manual lyric timing.",
        },
    }


def run_beat_this_shadow(path: Path) -> dict[str, Any]:
    capability = provider_capabilities()["beat_this"]
    if not capability["enabled"]:
        return {"status": "disabled", "provider": "beat_this"}
    if not capability["installed"]:
        return {"status": "unavailable", "provider": "beat_this", "reason": "package_not_installed"}

    try:
        from beat_this.inference import File2Beats  # type: ignore[import-not-found]

        checkpoint = os.getenv("ATLAS_BEAT_THIS_MODEL", "small0")
        device = os.getenv("ATLAS_BEAT_THIS_DEVICE", "cpu")
        tracker = File2Beats(checkpoint_path=checkpoint, device=device, dbn=False)
        beats_s, downbeats_s = tracker(str(path))
        beats_ms = sorted({max(0, int(round(float(value) * 1000.0))) for value in beats_s})
        downbeats_ms = sorted({max(0, int(round(float(value) * 1000.0))) for value in downbeats_s})
        return {
            "status": "completed",
            "provider": "beat_this",
            "mode": "shadow",
            "checkpoint": checkpoint,
            "device": device,
            "beats_ms": beats_ms,
            "downbeats_ms": downbeats_ms,
            "beat_count": len(beats_ms),
            "downbeat_count": len(downbeats_ms),
        }
    except Exception as exc:  # provider failures must never break canonical Track Intelligence
        return {
            "status": "failed",
            "provider": "beat_this",
            "mode": "shadow",
            "reason": str(exc)[:240],
        }


def run_basic_pitch_stem(path: Path, category: str) -> dict[str, Any]:
    capability = provider_capabilities()["basic_pitch"]
    if category in {"drums", "percussion", "fx"}:
        return {"status": "not_applicable", "provider": "basic_pitch", "category": category}
    if not capability["enabled"]:
        return {"status": "disabled", "provider": "basic_pitch", "category": category}
    if not capability["runtime_supported"]:
        return {"status": "unavailable", "provider": "basic_pitch", "category": category, "reason": "python_runtime_not_supported"}
    if not capability["installed"]:
        return {"status": "unavailable", "provider": "basic_pitch", "category": category, "reason": "package_not_installed"}

    try:
        from basic_pitch.inference import predict  # type: ignore[import-not-found]

        _, _, note_events = predict(str(path))
        normalized: list[dict[str, Any]] = []
        pitch_classes = [0] * 12
        for raw in note_events[:512]:
            if not isinstance(raw, (list, tuple)) or len(raw) < 4:
                continue
            start_s, end_s, pitch, amplitude = raw[:4]
            midi = int(round(float(pitch)))
            pitch_classes[midi % 12] += 1
            normalized.append({
                "start_ms": max(0, int(round(float(start_s) * 1000.0))),
                "end_ms": max(1, int(round(float(end_s) * 1000.0))),
                "midi": midi,
                "velocity": round(max(0.0, min(1.0, float(amplitude))), 4),
            })
        total = sum(pitch_classes) or 1
        return {
            "status": "completed",
            "provider": "basic_pitch",
            "category": category,
            "note_count": len(normalized),
            "notes": normalized,
            "pitch_class_profile": [round(value / total, 4) for value in pitch_classes],
        }
    except Exception as exc:
        return {
            "status": "failed",
            "provider": "basic_pitch",
            "category": category,
            "reason": str(exc)[:240],
        }
