from __future__ import annotations

import importlib.util
import math
import os
import sys
from collections import Counter
from pathlib import Path
from statistics import median
from typing import Any


CLAP_DEFAULT_MODEL = "laion/larger_clap_music_and_speech"
CLAP_DEFAULT_REVISION = "195c3a3e68faebb3e2088b9a79e79b43ddbda76b"
CLAP_SAMPLE_RATE = 48_000
CLAP_MAX_WINDOW_SECONDS = 10.0
CLAP_DESCRIPTOR_PROMPTS = (
    "an immediate attention-grabbing musical hook",
    "a driving dance groove with strong rhythmic momentum",
    "an intimate exposed vocal moment",
    "a tense musical build that is preparing a payoff",
    "a drop or release with a clear payoff",
    "a euphoric musical climax",
    "an atmospheric spacious musical passage",
    "a minimal sparse musical passage",
    "a dark nocturnal musical atmosphere",
    "a bright celebratory musical atmosphere",
    "a distinctive melodic identity or recurring motif",
    "a rhythm-forward passage with strong percussive identity",
    "a cinematic musical passage with a developing arc",
)


def _env(primary: str, legacy: str | None = None, default: str = "") -> str:
    value = os.getenv(primary)
    if value is not None and value.strip():
        return value.strip()
    if legacy:
        value = os.getenv(legacy)
        if value is not None and value.strip():
            return value.strip()
    return default


def _enabled(primary: str, legacy: str | None = None) -> bool:
    return _env(primary, legacy).lower() in {"1", "true", "yes", "on"}


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
            "enabled": _enabled("ENSEMBLIS_BEAT_THIS_ENABLED", "ATLAS_BEAT_THIS_ENABLED"),
            "mode": "shadow",
            "license_policy": "commercial_ok_mit",
            "tier": "deep_optional",
        },
        "basic_pitch": {
            "purpose": "optional note and melodic intelligence for tonal stems",
            "installed": _installed("basic_pitch"),
            "enabled": _enabled("ENSEMBLIS_BASIC_PITCH_ENABLED", "ATLAS_BASIC_PITCH_ENABLED"),
            "mode": "stem_only",
            "runtime_supported": sys.version_info < (3, 12),
            "tier": "on_demand_external_profile",
        },
        "clap": {
            "purpose": "cross-modal audio-to-text semantic evidence for musical moments",
            "installed": _installed("transformers") and _installed("torch"),
            "enabled": _enabled("ENSEMBLIS_CLAP_ENABLED", "ATLAS_CLAP_ENABLED"),
            "mode": "moment_semantics",
            "model": _env("ENSEMBLIS_CLAP_MODEL", "ATLAS_CLAP_MODEL", CLAP_DEFAULT_MODEL),
            "revision": _env("ENSEMBLIS_CLAP_REVISION", "ATLAS_CLAP_REVISION", CLAP_DEFAULT_REVISION),
            "allow_download": _enabled("ENSEMBLIS_CLAP_ALLOW_DOWNLOAD", "ATLAS_CLAP_ALLOW_DOWNLOAD"),
            "license_policy": "commercial_ok_apache_2_model_card_reviewed",
            "tier": "on_demand_external_profile",
            "note": "CLAP is additive semantic evidence. All-In-One remains the canonical structural representation.",
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

        checkpoint = _env("ENSEMBLIS_BEAT_THIS_MODEL", "ATLAS_BEAT_THIS_MODEL", "small0")
        device = _env("ENSEMBLIS_BEAT_THIS_DEVICE", "ATLAS_BEAT_THIS_DEVICE", "cpu")
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


def _melodic_representatives(notes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse near-simultaneous notes so contour/motif metrics are useful for polyphonic stems."""
    if not notes:
        return []
    ordered = sorted(notes, key=lambda note: (int(note["start_ms"]), -float(note.get("velocity") or 0.0)))
    groups: list[list[dict[str, Any]]] = []
    for note in ordered:
        if not groups or int(note["start_ms"]) - int(groups[-1][0]["start_ms"]) > 80:
            groups.append([note])
        else:
            groups[-1].append(note)
    return [max(group, key=lambda note: (float(note.get("velocity") or 0.0), int(note["midi"]))) for group in groups]


def summarize_melody(notes: list[dict[str, Any]]) -> dict[str, Any]:
    """Create compact, explainable melodic evidence from normalized Basic Pitch notes."""
    usable = [
        note
        for note in notes
        if isinstance(note, dict)
        and isinstance(note.get("start_ms"), (int, float))
        and isinstance(note.get("end_ms"), (int, float))
        and isinstance(note.get("midi"), (int, float))
        and int(note["end_ms"]) > int(note["start_ms"])
    ]
    if not usable:
        return {"available": False, "reason": "no_valid_notes"}

    usable.sort(key=lambda note: (int(note["start_ms"]), int(note["midi"])))
    pitches = [int(round(float(note["midi"]))) for note in usable]
    durations = [int(note["end_ms"]) - int(note["start_ms"]) for note in usable]
    span_ms = max(1, max(int(note["end_ms"]) for note in usable) - min(int(note["start_ms"]) for note in usable))
    pitch_counts = Counter(pitch % 12 for pitch in pitches)
    total = len(pitches)
    entropy = 0.0
    for count in pitch_counts.values():
        probability = count / total
        entropy -= probability * math.log2(probability)
    normalized_entropy = entropy / math.log2(12) if total > 1 else 0.0

    representatives = _melodic_representatives(usable)
    representative_pitches = [int(note["midi"]) for note in representatives]
    split = max(1, len(representative_pitches) // 2)
    early = representative_pitches[:split]
    late = representative_pitches[split:] or representative_pitches[-1:]
    contour_delta = float(median(late) - median(early))
    contour_direction = "rising" if contour_delta >= 2.0 else "falling" if contour_delta <= -2.0 else "stable"

    intervals = [right - left for left, right in zip(representative_pitches[:-1], representative_pitches[1:])]
    motif_counts: Counter[tuple[int, int, int]] = Counter(
        tuple(intervals[index : index + 3]) for index in range(max(0, len(intervals) - 2))
    )
    repeated_motifs: list[dict[str, Any]] = []
    for signature, count in motif_counts.most_common(5):
        if count < 2:
            continue
        first_interval_index = next(
            index
            for index in range(len(intervals) - 2)
            if tuple(intervals[index : index + 3]) == signature
        )
        repeated_motifs.append({
            "interval_signature": list(signature),
            "count": count,
            "first_start_ms": int(representatives[first_interval_index]["start_ms"]),
        })

    climax = max(usable, key=lambda note: (int(note["midi"]), float(note.get("velocity") or 0.0)))
    dominant_pitch_classes = [
        {"pitch_class": pitch_class, "share": round(count / total, 4)}
        for pitch_class, count in pitch_counts.most_common(3)
    ]

    return {
        "available": True,
        "note_count": total,
        "representative_note_count": len(representatives),
        "pitch": {
            "min_midi": min(pitches),
            "max_midi": max(pitches),
            "range_semitones": max(pitches) - min(pitches),
            "median_midi": round(float(median(pitches)), 2),
            "pitch_class_entropy": round(max(0.0, min(1.0, normalized_entropy)), 4),
            "dominant_pitch_classes": dominant_pitch_classes,
        },
        "rhythm": {
            "note_density_per_second": round(total / (span_ms / 1000.0), 4),
            "mean_note_duration_ms": round(sum(durations) / total, 2),
            "median_note_duration_ms": round(float(median(durations)), 2),
            "short_note_ratio": round(sum(duration < 250 for duration in durations) / total, 4),
            "sustained_note_ratio": round(sum(duration >= 800 for duration in durations) / total, 4),
        },
        "contour": {
            "direction": contour_direction,
            "early_median_midi": round(float(median(early)), 2),
            "late_median_midi": round(float(median(late)), 2),
            "delta_semitones": round(contour_delta, 2),
        },
        "climax": {
            "start_ms": int(climax["start_ms"]),
            "midi": int(climax["midi"]),
            "velocity": round(float(climax.get("velocity") or 0.0), 4),
        },
        "repeated_interval_motifs": repeated_motifs,
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
            "melodic_intelligence": summarize_melody(normalized),
        }
    except Exception as exc:
        return {
            "status": "failed",
            "provider": "basic_pitch",
            "category": category,
            "reason": str(exc)[:240],
        }


def _normalize_vector(values: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in values))
    if norm <= 1e-12:
        return [0.0 for value in values]
    return [value / norm for value in values]


def run_clap_audio_semantics(
    path: Path,
    windows: list[dict[str, Any]],
    prompts: tuple[str, ...] = CLAP_DESCRIPTOR_PROMPTS,
) -> dict[str, Any]:
    """Attach text-grounded semantic evidence to selected moments without changing canonical MIR."""
    capability = provider_capabilities()["clap"]
    if not capability["enabled"]:
        return {"status": "disabled", "provider": "clap"}
    if not capability["installed"]:
        return {"status": "unavailable", "provider": "clap", "reason": "semantic_profile_not_installed"}
    if not windows:
        return {"status": "not_applicable", "provider": "clap", "reason": "no_musical_windows"}

    try:
        import librosa
        import numpy as np
        import torch
        from transformers import ClapModel, ClapProcessor  # type: ignore[import-not-found]

        model_id = str(capability["model"])
        revision = str(capability["revision"])
        allow_download = bool(capability["allow_download"])
        load_options = {"revision": revision, "local_files_only": not allow_download}
        processor = ClapProcessor.from_pretrained(model_id, **load_options)
        model = ClapModel.from_pretrained(model_id, **load_options)
        model.eval()

        audio, _ = librosa.load(str(path), sr=CLAP_SAMPLE_RATE, mono=True)
        if audio.size == 0:
            return {"status": "failed", "provider": "clap", "reason": "empty_audio"}

        selected_windows = [window for window in windows[:8] if isinstance(window, dict)]
        excerpts: list[Any] = []
        normalized_windows: list[dict[str, Any]] = []
        max_samples = int(CLAP_SAMPLE_RATE * CLAP_MAX_WINDOW_SECONDS)
        for window in selected_windows:
            start_ms = max(0, int(window.get("start_ms") or 0))
            end_ms = max(start_ms + 1, int(window.get("end_ms") or start_ms + 1))
            center_ms = (start_ms + end_ms) // 2
            half_window_ms = int(CLAP_MAX_WINDOW_SECONDS * 500)
            excerpt_start_ms = max(start_ms, center_ms - half_window_ms)
            excerpt_end_ms = min(end_ms, excerpt_start_ms + int(CLAP_MAX_WINDOW_SECONDS * 1000))
            if excerpt_end_ms - excerpt_start_ms < 1000:
                excerpt_start_ms = max(0, center_ms - half_window_ms)
                excerpt_end_ms = min(int(len(audio) / CLAP_SAMPLE_RATE * 1000), excerpt_start_ms + int(CLAP_MAX_WINDOW_SECONDS * 1000))
            start_sample = int(excerpt_start_ms * CLAP_SAMPLE_RATE / 1000)
            end_sample = min(len(audio), int(excerpt_end_ms * CLAP_SAMPLE_RATE / 1000))
            excerpt = audio[start_sample:end_sample][:max_samples].astype(np.float32, copy=False)
            if excerpt.size < CLAP_SAMPLE_RATE:
                continue
            excerpts.append(excerpt)
            normalized_windows.append({
                "id": str(window.get("id") or f"window-{start_ms}-{end_ms}"),
                "start_ms": start_ms,
                "end_ms": end_ms,
                "excerpt_start_ms": excerpt_start_ms,
                "excerpt_end_ms": excerpt_end_ms,
            })

        if not excerpts:
            return {"status": "not_applicable", "provider": "clap", "reason": "windows_too_short"}

        with torch.no_grad():
            audio_inputs = processor(audio=excerpts, sampling_rate=CLAP_SAMPLE_RATE, return_tensors="pt", padding=True)
            text_inputs = processor(text=list(prompts), return_tensors="pt", padding=True)
            audio_features = model.get_audio_features(**audio_inputs)
            text_features = model.get_text_features(**text_inputs)

        audio_matrix = audio_features.detach().cpu().float().numpy()
        text_matrix = text_features.detach().cpu().float().numpy()
        text_matrix = np.asarray([_normalize_vector(row.tolist()) for row in text_matrix], dtype=np.float32)
        items: list[dict[str, Any]] = []
        for window, vector in zip(normalized_windows, audio_matrix):
            normalized_vector = _normalize_vector(vector.tolist())
            scores = np.dot(text_matrix, np.asarray(normalized_vector, dtype=np.float32))
            ranked = np.argsort(scores)[::-1][:5]
            descriptors = [
                {"text": prompts[int(index)], "similarity": round(float(scores[int(index)]), 5)}
                for index in ranked
            ]
            items.append({
                **window,
                "embedding": [round(float(value), 7) for value in normalized_vector],
                "descriptors": descriptors,
            })

        embedding_dim = len(items[0]["embedding"]) if items else 0
        return {
            "status": "completed",
            "provider": "clap",
            "model": model_id,
            "revision": revision,
            "embedding_dim": embedding_dim,
            "sample_rate": CLAP_SAMPLE_RATE,
            "window_policy": {"max_seconds": CLAP_MAX_WINDOW_SECONDS, "selection": "centered_inside_musical_moment"},
            "prompt_bank": list(prompts),
            "items": items,
        }
    except Exception as exc:
        return {
            "status": "failed",
            "provider": "clap",
            "reason": str(exc)[:320],
            "model": capability.get("model"),
            "revision": capability.get("revision"),
        }
