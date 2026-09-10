from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import imageio_ffmpeg

from app.automix_model import _energy_from_map, estimate_key, normalize_dj_bpm
from app.mastering_inspector import enrich_music_map_with_mastering
from app.music_intelligence_v4_runtime import analyze_music as analyze_music_v4

ANALYZER_VERSION = "ensemblis.library-bridge.analyzer.v1"
PLANNING_EVIDENCE_VERSION = "ensemblis.dj-library-planning-evidence.v1"
MAX_PLANNING_EVIDENCE_BYTES = 48 * 1024


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


def _sample(items: Any, limit: int) -> list[dict[str, Any]]:
    rows = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
    if len(rows) <= limit:
        return rows
    if limit <= 1:
        return rows[:1]
    indexes = sorted({round(index * (len(rows) - 1) / (limit - 1)) for index in range(limit)})
    return [rows[index] for index in indexes]


def _scrub(value: Any, source_path: str) -> Any:
    forbidden = {"path", "filepath", "file_path", "location", "fileuri", "file_uri", "rootpath", "root_path"}
    if isinstance(value, dict):
        return {
            key: _scrub(nested, source_path)
            for key, nested in value.items()
            if str(key).lower() not in forbidden
        }
    if isinstance(value, list):
        return [_scrub(item, source_path) for item in value]
    if isinstance(value, str):
        if source_path and source_path in value:
            return value.replace(source_path, "device-local://redacted")
        if value.lower().startswith("file://"):
            return "device-local://redacted"
    return value


def _compact_mastering(music_map: dict[str, Any]) -> dict[str, Any]:
    inspector = _record(music_map.get("mastering_inspector"))
    return {
        "technical_ready": inspector.get("technical_ready"),
        "issue_counts": _record(inspector.get("issue_counts")),
        "loudness": {
            key: value
            for key, value in _record(inspector.get("loudness")).items()
            if key in {"integrated_lufs"}
        },
        "peaks": {
            key: value
            for key, value in _record(inspector.get("peaks")).items()
            if key in {"true_peak_dbtp", "clipping_ratio"}
        },
        "dynamics": {
            key: value
            for key, value in _record(inspector.get("dynamics")).items()
            if key in {"crest_factor_db", "loudness_range_lu", "peak_to_loudness_ratio_lu"}
        },
    }


def _compact_music_map(music_map: dict[str, Any]) -> dict[str, Any]:
    beat_stability = _record(music_map.get("beat_stability"))
    compact_stability = {
        key: value
        for key, value in beat_stability.items()
        if key in {"classification", "confidence", "median_bpm", "local_jitter_bpm"}
    }
    compact_stability["timeline"] = _sample(beat_stability.get("timeline"), 96)
    moments = _record(music_map.get("moments"))
    compact_moments = {
        key: _sample(value, 8)
        for key, value in moments.items()
        if isinstance(value, list)
    }
    qc = {
        key: value
        for key, value in _record(music_map.get("master_qc")).items()
        if key in {"integrated_lufs", "true_peak_dbtp", "clipping_ratio", "crest_factor_db", "technical_ready"}
    }
    return {
        "version": music_map.get("version"),
        "analysis_version": music_map.get("analysis_version"),
        "duration_ms": music_map.get("duration_ms"),
        "bpm": music_map.get("bpm"),
        "sections": _sample(music_map.get("sections"), 64),
        "phrases": _sample(music_map.get("phrases"), 96),
        "energy_curve": _sample(music_map.get("energy_curve"), 96),
        "moments": compact_moments,
        "beat_stability": compact_stability,
        "mastering_inspector": _compact_mastering(music_map),
        "master_qc": qc,
        "automix_vocals_activity_curve": _sample(music_map.get("automix_vocals_activity_curve"), 96),
        "automix_bass_activity_curve": _sample(music_map.get("automix_bass_activity_curve"), 96),
    }


def _standardize(source: Path, target: Path) -> None:
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-vn",
            "-ac",
            "2",
            "-ar",
            "44100",
            "-c:a",
            "pcm_f32le",
            str(target),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def analyze(source: Path, fingerprint: str) -> dict[str, Any]:
    if not source.is_file():
        raise ValueError("local analysis source is unavailable")
    if not fingerprint.startswith("sha256:"):
        raise ValueError("local analysis requires a content fingerprint")

    with tempfile.TemporaryDirectory(prefix="ensemblis-bridge-analysis-") as directory:
        wav = Path(directory) / "source.wav"
        _standardize(source, wav)
        music_map = analyze_music_v4(
            wav,
            {"url": f"device-local://{fingerprint}", "recording_fingerprint": fingerprint},
        )
        music_map = enrich_music_map_with_mastering(music_map, wav)
        bpm = _finite(music_map.get("bpm"), 0.0)
        if bpm <= 0:
            bpm = _finite(_record(music_map.get("beat_stability")).get("median_bpm"), 120.0)
        key = estimate_key(wav)
        duration_ms = max(0, int(music_map.get("duration_ms") or 0))
        loudness = _record(music_map.get("master_qc")).get("integrated_lufs")
        compact = _scrub(_compact_music_map(music_map), str(source))
        planning_evidence = {
            "version": PLANNING_EVIDENCE_VERSION,
            "analyzerVersion": ANALYZER_VERSION,
            "recordingFingerprint": fingerprint,
            "descriptor": {
                "durationMs": duration_ms,
                "bpm": bpm,
                "djBpm": normalize_dj_bpm(bpm),
                "key": {
                    "rootPc": key.root_pc,
                    "mode": key.mode,
                    "confidence": key.confidence,
                    "camelot": key.camelot,
                    "label": key.label,
                },
                "energy": _energy_from_map(compact),
                "loudnessLufs": _finite(loudness) if loudness is not None else None,
            },
            "musicMap": compact,
        }
        encoded = json.dumps(planning_evidence, separators=(",", ":")).encode("utf-8")
        if len(encoded) > MAX_PLANNING_EVIDENCE_BYTES:
            raise ValueError("compacted local planning evidence exceeds the per-track safety budget")
        stability = _record(compact.get("beat_stability"))
        result = {
            "version": ANALYZER_VERSION,
            "metadata": {
                "title": source.stem or "Untitled",
                "artist": None,
                "album": None,
                "remix": None,
                "genre": None,
                "comments": None,
                "durationMs": duration_ms,
                "bpm": bpm,
                "musicalKey": key.camelot,
                "rating": None,
                "color": None,
                "tags": [],
                "year": None,
            },
            "beatGrid": {
                "bpm": bpm,
                "firstBeatMs": 0,
                "beatsPerBar": 4,
                "confidence": max(0.0, min(1.0, _finite(stability.get("confidence"), 0.75))),
                "variableTempo": str(stability.get("classification") or "unknown") in {"drifting", "section_tempo_changes", "unstable"},
            },
            "analysisProvenance": [
                {"field": "metadata", "source": ANALYZER_VERSION, "confidence": 0.8},
                {"field": "bpm", "source": ANALYZER_VERSION, "confidence": max(0.5, _finite(stability.get("confidence"), 0.75))},
                {"field": "key", "source": ANALYZER_VERSION, "confidence": key.confidence},
                {"field": "grid", "source": ANALYZER_VERSION, "confidence": max(0.5, _finite(stability.get("confidence"), 0.75))},
            ],
            "planningEvidence": planning_evidence,
        }
        return _scrub(result, str(source))


def main() -> int:
    parser = argparse.ArgumentParser(description="Ensemblis local DJ-library analyzer")
    parser.add_argument("--source", required=True)
    parser.add_argument("--fingerprint", required=True)
    parser.add_argument("--result", required=True)
    args = parser.parse_args()
    try:
        result = analyze(Path(args.source), args.fingerprint)
        Path(args.result).write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
        return 0
    except Exception as exc:
        print(f"local analysis failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
