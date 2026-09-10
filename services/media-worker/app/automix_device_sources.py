from __future__ import annotations

from pathlib import Path
from typing import Any

from .automix_model import (
    MAX_TRACKS,
    MIN_TRACK_WINDOW_MS,
    MusicalKey,
    Purpose,
    TrackDescriptor,
    _clip01,
    _record,
    _safe_float,
    choose_showcase_window,
    normalize_dj_bpm,
)

PLANNING_EVIDENCE_VERSION = "ensemblis.dj-library-planning-evidence.v1"
SOURCE_REF_VERSION = "ensemblis.automix-source.v1"


def _device_track(raw: dict[str, Any], desired_ms: int, purpose: Purpose) -> TrackDescriptor:
    if str(raw.get("execution_target") or "") != "device":
        raise ValueError("Device planning evidence can only describe device-executed sources")
    evidence = _record(raw.get("planning_evidence"))
    if evidence.get("version") != PLANNING_EVIDENCE_VERSION:
        raise ValueError("Device track is missing supported planning evidence")
    descriptor = _record(evidence.get("descriptor"))
    music_map = _record(evidence.get("musicMap"))
    source_ref = _record(raw.get("source_ref"))
    if source_ref.get("version") != SOURCE_REF_VERSION or source_ref.get("executionTarget") != "device":
        raise ValueError("Device track source reference is invalid")

    track_id = str(raw.get("id") or "")
    title = str(raw.get("title") or "Untitled")
    expected_fingerprint = str(raw.get("recording_fingerprint") or "")
    evidence_fingerprint = str(evidence.get("recordingFingerprint") or "")
    source_fingerprint = str(source_ref.get("recordingFingerprint") or "")
    if (
        not track_id
        or not expected_fingerprint.startswith("sha256:")
        or evidence_fingerprint != expected_fingerprint
        or source_fingerprint != expected_fingerprint
    ):
        raise ValueError("Device track recording identity is invalid")

    duration_ms = int(_safe_float(descriptor.get("durationMs"), 0.0))
    map_duration_ms = int(_safe_float(music_map.get("duration_ms"), 0.0))
    bpm = _safe_float(descriptor.get("bpm"), 0.0)
    dj_bpm = _safe_float(descriptor.get("djBpm"), 0.0)
    if duration_ms <= 0 or map_duration_ms <= 0 or abs(duration_ms - map_duration_ms) > 2_000:
        raise ValueError("Device track duration evidence is invalid")
    if bpm <= 0 or dj_bpm <= 0 or abs(normalize_dj_bpm(bpm) - dj_bpm) > 0.5:
        raise ValueError("Device track tempo evidence is invalid")

    key_raw = _record(descriptor.get("key"))
    root_pc = int(_safe_float(key_raw.get("rootPc"), -1.0))
    mode = str(key_raw.get("mode") or "")
    camelot = str(key_raw.get("camelot") or "")
    label = str(key_raw.get("label") or camelot)
    confidence = _clip01(_safe_float(key_raw.get("confidence"), -1.0))
    if root_pc < 0 or root_pc > 11 or mode not in {"major", "minor"} or not camelot:
        raise ValueError("Device track key evidence is invalid")
    key = MusicalKey(root_pc, mode, confidence, camelot, label)  # type: ignore[arg-type]

    energy = _clip01(_safe_float(descriptor.get("energy"), 0.5))
    loudness_raw = descriptor.get("loudnessLufs")
    loudness = _safe_float(loudness_raw) if isinstance(loudness_raw, (int, float)) else None
    start_ms, end_ms, window_score = choose_showcase_window(music_map, desired_ms, purpose)
    if end_ms <= start_ms or end_ms > duration_ms:
        raise ValueError("Device track planning window is invalid")

    return TrackDescriptor(
        id=track_id,
        title=title,
        url="",
        path=Path(),
        music_map=music_map,
        duration_ms=duration_ms,
        bpm=bpm,
        dj_bpm=dj_bpm,
        key=key,
        energy=energy,
        loudness_lufs=loudness,
        window_start_ms=start_ms,
        window_end_ms=end_ms,
        window_score=window_score,
    )


def prepare_device_tracks(
    raw_tracks: list[dict[str, Any]],
    purpose: Purpose,
    target_duration_ms: int,
    total_track_count: int | None = None,
) -> list[TrackDescriptor]:
    if not 1 <= len(raw_tracks) <= MAX_TRACKS:
        raise ValueError(f"AutoMix device evidence requires 1-{MAX_TRACKS} tracks")
    divisor = total_track_count if total_track_count is not None else len(raw_tracks)
    if divisor < len(raw_tracks) or divisor > MAX_TRACKS:
        raise ValueError("AutoMix hybrid track count is invalid")
    desired = max(MIN_TRACK_WINDOW_MS, int(target_duration_ms / divisor) + 16_000)
    return [_device_track(raw, desired, purpose) for raw in raw_tracks]


def device_source_fingerprints(raw_tracks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    fingerprints: list[dict[str, Any]] = []
    for raw in raw_tracks:
        source_ref = _record(raw.get("source_ref"))
        fingerprints.append({
            "track_id": str(raw.get("id") or ""),
            "execution_target": "device",
            "source_kind": source_ref.get("kind"),
            "source_id": source_ref.get("librarySourceId"),
            "source_track_id": source_ref.get("trackId"),
            "recording_fingerprint": raw.get("recording_fingerprint"),
            "revision": source_ref.get("revision"),
        })
    return fingerprints
