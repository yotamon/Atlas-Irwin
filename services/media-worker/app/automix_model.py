from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import librosa
import numpy as np

AUTOMIX_VERSION = "ensemblis.automix.v1"
SAMPLE_RATE = 44100
MAX_TRACKS = 20
MAX_RENDER_MS = 60 * 60 * 1000
MAX_BEATMATCH_STRETCH = 0.06
MIN_TRACK_WINDOW_MS = 45_000

Purpose = Literal["booking", "soundcloud", "journey", "peak_time", "warm_up", "discovery"]
EnergyProfile = Literal["smooth", "dynamic", "peak"]
TransitionStyle = Literal["clean", "dj", "creative"]


@dataclass(frozen=True)
class MusicalKey:
    root_pc: int
    mode: Literal["major", "minor"]
    confidence: float
    camelot: str
    label: str


@dataclass
class TrackDescriptor:
    id: str
    title: str
    url: str
    path: Path
    music_map: dict[str, Any]
    duration_ms: int
    bpm: float
    dj_bpm: float
    key: MusicalKey
    energy: float
    loudness_lufs: float | None
    window_start_ms: int
    window_end_ms: int
    window_score: float


_MAJOR_CAMELOT = {
    11: "1B", 6: "2B", 1: "3B", 8: "4B", 3: "5B", 10: "6B",
    5: "7B", 0: "8B", 7: "9B", 2: "10B", 9: "11B", 4: "12B",
}
_MINOR_CAMELOT = {
    8: "1A", 3: "2A", 10: "3A", 5: "4A", 0: "5A", 7: "6A",
    2: "7A", 9: "8A", 4: "9A", 11: "10A", 6: "11A", 1: "12A",
}
_NOTE_NAMES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
_MAJOR_PROFILE = np.asarray([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], dtype=np.float64)
_MINOR_PROFILE = np.asarray([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17], dtype=np.float64)


def _clip01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list_records(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError):
        return default


def normalize_dj_bpm(bpm: float) -> float:
    bpm = max(1.0, float(bpm))
    while bpm < 78.0:
        bpm *= 2.0
    while bpm > 170.0:
        bpm /= 2.0
    return bpm


def estimate_key(path: Path) -> MusicalKey:
    y, sr = librosa.load(path, sr=22050, mono=True, duration=480.0, res_type="soxr_hq")
    if y.size < sr:
        return MusicalKey(0, "major", 0.0, "8B", "C major")
    harmonic = librosa.effects.harmonic(y, margin=3.0)
    chroma = librosa.feature.chroma_cqt(y=harmonic, sr=sr, hop_length=2048)
    weights = np.median(chroma, axis=1)
    norm = float(np.linalg.norm(weights))
    if norm <= 1e-9:
        return MusicalKey(0, "major", 0.0, "8B", "C major")
    weights = weights / norm
    scores: list[tuple[float, int, Literal["major", "minor"]]] = []
    for root in range(12):
        major = np.roll(_MAJOR_PROFILE, root)
        minor = np.roll(_MINOR_PROFILE, root)
        scores.append((float(np.dot(weights, major / np.linalg.norm(major))), root, "major"))
        scores.append((float(np.dot(weights, minor / np.linalg.norm(minor))), root, "minor"))
    scores.sort(reverse=True, key=lambda item: item[0])
    best, second = scores[0], scores[1]
    margin = max(0.0, best[0] - second[0])
    confidence = _clip01(0.35 + margin * 4.5)
    camelot = (_MAJOR_CAMELOT if best[2] == "major" else _MINOR_CAMELOT)[best[1]]
    return MusicalKey(best[1], best[2], confidence, camelot, f"{_NOTE_NAMES[best[1]]} {best[2]}")


def harmonic_compatibility(a: MusicalKey, b: MusicalKey) -> float:
    a_num, a_letter = int(a.camelot[:-1]), a.camelot[-1]
    b_num, b_letter = int(b.camelot[:-1]), b.camelot[-1]
    distance = min((a_num - b_num) % 12, (b_num - a_num) % 12)
    if a_num == b_num and a_letter == b_letter:
        base = 1.0
    elif a_num == b_num and a_letter != b_letter:
        base = 0.96
    elif distance == 1 and a_letter == b_letter:
        base = 0.94
    elif distance == 2 and a_letter == b_letter:
        base = 0.72
    elif distance == 1 and a_letter != b_letter:
        base = 0.62
    else:
        base = max(0.08, 0.50 - distance * 0.08)
    confidence = math.sqrt(max(0.05, a.confidence) * max(0.05, b.confidence))
    return _clip01(base * (0.62 + 0.38 * confidence))


def bpm_compatibility(a_bpm: float, b_bpm: float) -> tuple[float, float]:
    a = normalize_dj_bpm(a_bpm)
    b = normalize_dj_bpm(b_bpm)
    ratio = max(a, b) / max(1e-6, min(a, b))
    delta = ratio - 1.0
    return _clip01(1.0 - delta / 0.12), delta


def _energy_from_map(music_map: dict[str, Any]) -> float:
    curve = _list_records(music_map.get("energy_curve"))
    values = [_safe_float(item.get("value"), -1.0) for item in curve]
    values = [value for value in values if value >= 0.0]
    if values:
        return _clip01(float(np.percentile(values, 72)))
    moments = _list_records(music_map.get("moments"))
    scores = [_safe_float(item.get("score"), 0.0) for item in moments]
    return _clip01(float(np.mean(scores))) if scores else 0.5


def _intent_for_purpose(purpose: Purpose) -> str:
    return {
        "booking": "musical_identity",
        "soundcloud": "groove_loop",
        "journey": "story_arc",
        "peak_time": "climax",
        "warm_up": "story_arc",
        "discovery": "instant_hook",
    }[purpose]


def _boundary_points(music_map: dict[str, Any]) -> list[tuple[int, float, str]]:
    duration = int(music_map.get("duration_ms") or 0)
    points: dict[int, tuple[float, str]] = {0: (0.8, "start"), duration: (0.8, "end")}
    for section in _list_records(music_map.get("sections")):
        label = str(section.get("label") or "section").lower()
        confidence = _safe_float(section.get("boundary_confidence"), _safe_float(section.get("confidence"), 0.55))
        for key in ("start_ms", "end_ms"):
            ms = int(section.get(key) or 0)
            if 0 <= ms <= duration:
                current = points.get(ms, (0.0, ""))
                if confidence > current[0]:
                    points[ms] = (_clip01(confidence), label)
    for phrase in _list_records(music_map.get("phrases")):
        confidence = _safe_float(phrase.get("confidence"), 0.5)
        for key in ("start_ms", "end_ms"):
            ms = int(phrase.get(key) or 0)
            if 0 <= ms <= duration:
                current = points.get(ms, (0.0, ""))
                score = _clip01(0.72 * confidence + 0.12)
                if score > current[0]:
                    points[ms] = (score, "phrase")
    downbeat_source = str(music_map.get("downbeat_source") or "none")
    db_conf = 0.96 if downbeat_source == "model" else 0.63 if downbeat_source == "inferred_from_beats" else 0.42
    for raw in music_map.get("downbeats_ms") or []:
        if not isinstance(raw, (int, float)):
            continue
        ms = int(raw)
        if 0 <= ms <= duration:
            current = points.get(ms, (0.0, ""))
            if db_conf > current[0]:
                points[ms] = (db_conf, "downbeat")
    return [(ms, score, label) for ms, (score, label) in sorted(points.items())]


def _moment_anchor(music_map: dict[str, Any], purpose: Purpose) -> tuple[int, int, float]:
    intent = _intent_for_purpose(purpose)
    candidates = _list_records(music_map.get("moments")) or _list_records(music_map.get("hook_candidates"))
    ranked: list[tuple[float, dict[str, Any]]] = []
    for item in candidates:
        intents = _record(item.get("intent_scores"))
        intent_score = _safe_float(intents.get(intent), _safe_float(item.get("score"), 0.0))
        completeness = _safe_float(item.get("musical_completeness"), 0.5)
        ranked.append((_clip01(0.78 * intent_score + 0.22 * completeness), item))
    if ranked:
        ranked.sort(key=lambda pair: pair[0], reverse=True)
        score, item = ranked[0]
        return int(item.get("start_ms") or 0), int(item.get("end_ms") or 0), score
    duration = int(music_map.get("duration_ms") or 0)
    start = int(duration * 0.35)
    return start, min(duration, start + 30_000), 0.4


def choose_showcase_window(music_map: dict[str, Any], desired_ms: int, purpose: Purpose) -> tuple[int, int, float]:
    duration = int(music_map.get("duration_ms") or 0)
    desired = min(duration, max(MIN_TRACK_WINDOW_MS, desired_ms))
    anchor_start, anchor_end, anchor_score = _moment_anchor(music_map, purpose)
    boundaries = _boundary_points(music_map)
    if not boundaries:
        start = max(0, min(duration - desired, anchor_start - desired // 3))
        return start, min(duration, start + desired), anchor_score

    best: tuple[float, int, int] | None = None
    tolerance = max(12_000, int(desired * 0.42))
    for left_ms, left_conf, left_label in boundaries:
        if left_ms > anchor_start:
            break
        for right_ms, right_conf, right_label in boundaries:
            if right_ms < anchor_end or right_ms <= left_ms:
                continue
            length = right_ms - left_ms
            if length < max(MIN_TRACK_WINDOW_MS, int(desired * 0.58)) or abs(length - desired) > tolerance:
                continue
            length_fit = math.exp(-abs(length - desired) / max(1.0, desired * 0.33))
            edge = math.sqrt(max(0.05, left_conf) * max(0.05, right_conf))
            label_bonus = 0.0
            if any(word in left_label for word in ("intro", "break", "verse", "phrase", "downbeat")):
                label_bonus += 0.04
            if any(word in right_label for word in ("outro", "break", "phrase", "downbeat")):
                label_bonus += 0.04
            score = _clip01(0.46 * anchor_score + 0.30 * length_fit + 0.20 * edge + label_bonus)
            if best is None or score > best[0]:
                best = (score, left_ms, right_ms)
    if best:
        return best[1], best[2], best[0]
    start = max(0, min(duration - desired, anchor_start - desired // 3))
    return start, min(duration, start + desired), _clip01(anchor_score * 0.82)

