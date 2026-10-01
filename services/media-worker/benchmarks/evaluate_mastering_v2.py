from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.mastering_evaluation import build_perceptual_delta  # noqa: E402
from app.mastering_inspector import analyze_mastering  # noqa: E402
from app.mastering_processor import master_audio  # noqa: E402


LISTENING_QUESTIONS = [
    "tonal_balance_preference",
    "punch_transient_preservation",
    "low_end_clarity",
    "harshness_fatigue",
    "width_translation",
    "loudness_without_damage",
    "overall_preference",
    "would_release_this_version",
]


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _load_json(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    return _record(json.loads(path.read_text(encoding="utf-8")))


def _resolve(base: Path, value: Any) -> Path | None:
    text = str(value or "").strip()
    if not text:
        return None
    path = Path(text)
    return path if path.is_absolute() else (base / path).resolve()


def _copy_blind(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def run_case(
    case: dict[str, Any],
    *,
    base: Path,
    output_root: Path,
    rng: random.Random,
) -> dict[str, Any]:
    case_id = str(case.get("id") or "").strip()
    if not case_id:
        raise ValueError("Every mastering benchmark case requires an id.")
    source = _resolve(base, case.get("source"))
    if source is None or not source.exists():
        raise FileNotFoundError(f"{case_id}: source audio not found.")

    baseline = _resolve(base, case.get("v1_baseline"))
    map_path = _resolve(base, case.get("music_map"))
    music_map = _load_json(map_path)
    preset = str(case.get("preset") or "balanced")
    references = [
        item for item in case.get("reference_signatures") or []
        if isinstance(item, dict)
    ]
    artist_preferences = _record(case.get("artist_mastering_preferences"))

    case_root = output_root / "cases" / case_id
    case_root.mkdir(parents=True, exist_ok=True)
    v2_path = case_root / "v2.flac"
    result = master_audio(
        source,
        v2_path,
        preset=preset,
        music_map=music_map,
        reference_signatures=references,
        artist_preferences=artist_preferences,
        workdir=case_root,
    )
    source_inspector = _record(result.get("before")) or analyze_mastering(source, music_map)
    v2_inspector = _record(result.get("after")) or analyze_mastering(v2_path, music_map)
    baseline_inspector = analyze_mastering(baseline, music_map) if baseline and baseline.exists() else None

    candidates: list[tuple[str, Path]] = [("source", source), ("v2", v2_path)]
    if baseline and baseline.exists():
        candidates.append(("v1", baseline))
    shuffled = candidates[:]
    rng.shuffle(shuffled)

    blind_root = output_root / "blind" / case_id
    mapping: dict[str, str] = {}
    public_rows: list[dict[str, Any]] = []
    labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    for index, (identity, path) in enumerate(shuffled):
        label = labels[index]
        suffix = path.suffix.lower() or ".audio"
        destination = blind_root / f"{label}{suffix}"
        _copy_blind(path, destination)
        mapping[label] = identity
        public_rows.append({
            "label": label,
            "path": str(destination.relative_to(output_root)),
        })

    return {
        "id": case_id,
        "preset": preset,
        "source": {
            "path": str(source),
            "inspector": source_inspector,
        },
        "v1_baseline": {
            "path": str(baseline) if baseline else None,
            "inspector": baseline_inspector,
            "delta_from_source": (
                build_perceptual_delta(source_inspector, baseline_inspector, {})
                if baseline_inspector
                else None
            ),
        },
        "v2": {
            "path": str(v2_path),
            "result": result,
            "delta_from_source": build_perceptual_delta(
                source_inspector,
                v2_inspector,
                _record(result.get("iterations")[-1].get("render_measurement"))
                if isinstance(result.get("iterations"), list) and result.get("iterations")
                else {},
            ),
        },
        "blind": {
            "candidates": public_rows,
            "private_mapping": mapping,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate Active Mastering V2 on a private local catalog without committing audio."
    )
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--seed", type=int, default=279)
    args = parser.parse_args()

    manifest = _record(json.loads(args.manifest.read_text(encoding="utf-8")))
    cases = [item for item in manifest.get("cases") or [] if isinstance(item, dict)]
    if not cases:
        raise ValueError("Benchmark manifest contains no cases.")

    output_root = args.output.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    results = [
        run_case(
            case,
            base=args.manifest.parent.resolve(),
            output_root=output_root,
            rng=rng,
        )
        for case in cases
    ]

    public_form = {
        "schema": "ensemblis.mastering_blind_listening.v1",
        "questions": LISTENING_QUESTIONS,
        "cases": [
            {
                "id": row["id"],
                "preset": row["preset"],
                "candidates": row["blind"]["candidates"],
            }
            for row in results
        ],
        "instructions": (
            "Listen at matched playback level when comparing source/master preference. "
            "For release-sequence questions, use actual relative master levels. "
            "Do not reveal candidate identity until scoring is complete."
        ),
    }
    private_mapping = {
        "schema": "ensemblis.mastering_blind_mapping.v1",
        "seed": args.seed,
        "cases": {
            row["id"]: row["blind"]["private_mapping"]
            for row in results
        },
    }
    objective = {
        "schema": "ensemblis.mastering_benchmark.v2",
        "case_count": len(results),
        "cases": [
            {key: value for key, value in row.items() if key != "blind"}
            for row in results
        ],
    }

    (output_root / "objective-results.json").write_text(
        json.dumps(objective, indent=2),
        encoding="utf-8",
    )
    (output_root / "blind-listening-form.json").write_text(
        json.dumps(public_form, indent=2),
        encoding="utf-8",
    )
    (output_root / "blind-mapping.private.json").write_text(
        json.dumps(private_mapping, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({
        "cases": len(results),
        "output": str(output_root),
        "objective": "objective-results.json",
        "blind_form": "blind-listening-form.json",
        "private_mapping": "blind-mapping.private.json",
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
