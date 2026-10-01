from __future__ import annotations

import asyncio
import json
import math
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Literal

import httpx
import imageio_ffmpeg
from pydantic import BaseModel, Field

from .main import download, sha256_file, upload_file
from .mastering_candidates import build_candidate_family, build_candidate_processing_plan, select_candidate
from .mastering_character import build_character_permission
from .mastering_contracts import build_v2_target_contract
from .mastering_dynamics import build_dynamics_plan
from .mastering_evaluation import build_perceptual_delta, evaluate_change_budget
from .mastering_inspector import analyze_mastering
from .mastering_preferences import apply_mastering_preferences
from .mastering_references import (
    select_references,
    weighted_reference_bands,
    weighted_reference_value,
)
from .mastering_resonance import build_resonance_plan
from .mastering_stereo import build_stereo_plan
from .mastering_tonal import build_tonal_plan

ACTIVE_MASTERING_SCHEMA = "ensemblis.active_mastering.v2"
ACTIVE_MASTERING_LEGACY_SCHEMA = "ensemblis.active_mastering.v1"
FFMPEG_BINARY = imageio_ffmpeg.get_ffmpeg_exe()
# Supabase Free projects cap individual Storage objects at 50 MB globally.
# Keep a small transport margin so signed uploads never sit on the plan boundary.
MAX_MASTERING_UPLOAD_BYTES = 48_000_000
MASTERING_CHUNK_BYTES = 45_000_000

PRESET_TARGETS: dict[str, dict[str, float]] = {
    "streaming_safe": {"integrated_lufs": -12.0, "true_peak_dbtp": -1.0, "compression_ratio": 1.0},
    "balanced": {"integrated_lufs": -10.0, "true_peak_dbtp": -1.2, "compression_ratio": 1.35},
    "punchy": {"integrated_lufs": -9.0, "true_peak_dbtp": -1.2, "compression_ratio": 1.5},
    "dynamic": {"integrated_lufs": -11.5, "true_peak_dbtp": -1.3, "compression_ratio": 1.0},
}
class MasteringWorkerRequest(BaseModel):
    job_id: str
    job_type: Literal["master_audio"]
    payload: dict[str, Any] = Field(default_factory=dict)
    callback_url: str
    callback_token: str


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def build_mastering_target(
    preset: str,
    source_inspector: dict[str, Any],
    reference_signatures: list[dict[str, Any]],
    artist_preferences: dict[str, Any] | None = None,
) -> dict[str, Any]:
    selected = PRESET_TARGETS.get(preset, PRESET_TARGETS["balanced"])
    valid_refs = [
        item for item in reference_signatures
        if isinstance(item, dict) and _number(item.get("integrated_lufs")) is not None
    ]
    source_signature = _record(source_inspector.get("reference_signature"))
    reference_intelligence = select_references(source_signature, valid_refs)
    catalog_lufs = weighted_reference_value(reference_intelligence, "integrated_lufs")
    source_loudness = _record(source_inspector.get("loudness"))
    source_peaks = _record(source_inspector.get("peaks"))
    source_lufs = _number(source_loudness.get("integrated_lufs"))
    source_true_peak = _number(source_loudness.get("true_peak_dbtp"))
    if source_true_peak is None:
        source_true_peak = _number(source_peaks.get("true_peak_dbtp"))
    target_lufs = selected["integrated_lufs"]
    reference_source = "preset"
    static_gain_db = 0.0
    if preset == "streaming_safe":
        reference_source = "source_preservation"
    elif catalog_lufs is not None and bool(reference_intelligence.get("automatic_influence")):
        confidence = _number(reference_intelligence.get("influence_confidence")) or 0.0
        reference_weight = _clamp(0.25 + confidence * 0.25, 0.25, 0.50)
        target_lufs = _clamp(
            (target_lufs * (1.0 - reference_weight)) + (catalog_lufs * reference_weight),
            -13.0,
            -8.5,
        )
        reference_source = "similar_trusted_references"

    codec_rows = source_inspector.get("codec_stress") or []
    codec_risk = any(
        isinstance(item, dict)
        and item.get("status") == "completed"
        and bool(item.get("very_low_headroom"))
        for item in codec_rows
    )
    true_peak = selected["true_peak_dbtp"]
    if preset == "streaming_safe":
        true_peak = -2.0 if source_lufs is not None and source_lufs > -14.0 else -1.0
        if codec_risk:
            true_peak = min(true_peak, -2.0)
        if source_true_peak is not None:
            static_gain_db = min(0.0, true_peak - source_true_peak)
        target_lufs = (
            source_lufs + static_gain_db
            if source_lufs is not None
            else selected["integrated_lufs"] + static_gain_db
        )
    elif codec_risk:
        true_peak = min(true_peak, -1.8)

    source_dynamics = _record(source_inspector.get("dynamics"))
    source_lra = _number(source_dynamics.get("loudness_range_lu"))
    max_lra = _clamp(max(source_lra or 0.0, 11.0), 7.0, 18.0)

    v2_contract = build_v2_target_contract(
        preset=preset,
        preferred_lufs=target_lufs,
        true_peak_dbtp=true_peak,
        source_inspector=source_inspector,
    )
    preference_policy = apply_mastering_preferences(
        preset=preset,
        preferred_lufs=target_lufs,
        change_budget=_record(v2_contract.get("change_budget")),
        preferences=_record(artist_preferences),
    )
    preferred_after_memory = _number(preference_policy.get("preferred_lufs"))
    if preferred_after_memory is not None:
        target_lufs = preferred_after_memory
        v2_contract = build_v2_target_contract(
            preset=preset,
            preferred_lufs=target_lufs,
            true_peak_dbtp=true_peak,
            source_inspector=source_inspector,
        )
        v2_contract["change_budget"] = preference_policy["change_budget"]

    return {
        "schema": v2_contract["schema"],
        "candidate_schema": v2_contract["candidate_schema"],
        "preset": preset if preset in PRESET_TARGETS else "balanced",
        "integrated_lufs": round(target_lufs, 2),
        "true_peak_dbtp": round(true_peak, 2),
        "max_lra_lu": round(max_lra, 2),
        "reference_source": reference_source,
        "reference_count": len(valid_refs),
        "selected_reference_count": int(reference_intelligence.get("selected_count") or 0),
        "reference_influence_confidence": round(float(reference_intelligence.get("influence_confidence") or 0.0), 4),
        "reference_intelligence": {
            "schema": reference_intelligence.get("schema"),
            "automatic_influence": reference_intelligence.get("automatic_influence"),
            "available_count": reference_intelligence.get("available_count"),
            "selected_count": reference_intelligence.get("selected_count"),
            "influence_confidence": reference_intelligence.get("influence_confidence"),
            "ranked": reference_intelligence.get("ranked"),
        },
        "catalog_integrated_lufs": round(catalog_lufs, 2) if catalog_lufs is not None else None,
        "codec_headroom_guard": codec_risk,
        "preserve_source": preset == "streaming_safe",
        "static_gain_db": round(static_gain_db, 2) if preset == "streaming_safe" else None,
        "source_true_peak_dbtp": round(source_true_peak, 2) if source_true_peak is not None else None,
        "loudness_range": v2_contract["loudness_range"],
        "true_peak": v2_contract["true_peak"],
        "change_budget": v2_contract["change_budget"],
        "source_resolution": v2_contract["source_resolution"],
        "decision_policy": v2_contract["decision_policy"],
        "artist_preference_policy": preference_policy,
    }


def build_processing_plan(
    preset: str,
    source_inspector: dict[str, Any],
    target: dict[str, Any],
    reference_signatures: list[dict[str, Any]],
) -> dict[str, Any]:
    source_signature = _record(source_inspector.get("reference_signature"))
    selection = select_references(source_signature, reference_signatures)
    reference_broad = (
        weighted_reference_bands(selection, "band_relative_db")
        if target.get("reference_source") == "similar_trusted_references"
        else {}
    )
    reference_fine = (
        weighted_reference_bands(selection, "perceptual_envelope_db")
        if target.get("reference_source") == "similar_trusted_references"
        else {}
    )
    tonal = build_tonal_plan(
        preset=preset,
        source_inspector=source_inspector,
        target=target,
        reference_bands=reference_fine,
        legacy_reference_bands=reference_broad,
    )
    resonance = build_resonance_plan(
        preset=preset,
        source_inspector=source_inspector,
        target=target,
        reference_bands=reference_fine,
    )
    dynamics_plan = build_dynamics_plan(preset, source_inspector, target)
    character = build_character_permission(
        preset=preset,
        source_inspector=source_inspector,
        target=target,
    )
    stereo_plan = build_stereo_plan(preset, source_inspector, target)

    issues = source_inspector.get("issues") or []
    phase_risk = any(
        isinstance(item, dict) and item.get("code") in {"phase_risk", "localized_mono_loss"}
        for item in issues
    )

    return {
        "schema": "ensemblis.active_mastering.v2",
        "eq_moves": tonal["eq_moves"],
        "highpass_hz": tonal["highpass_hz"],
        "tonal": tonal,
        "resonance": resonance,
        "compression": dynamics_plan,
        "character": character,
        "stereo": {
            **stereo_plan,
            "phase_risk_detected": phase_risk,
            "note": "V2 forbids blind widening. Any automatic stereo move can only reduce Side energy and is re-measured for mono/phase regression.",
        },
        "loudness": {
            "integrated_lufs": target["integrated_lufs"],
            "true_peak_dbtp": target["true_peak_dbtp"],
            "max_lra_lu": target["max_lra_lu"],
            "engine": "static_gain" if preset == "streaming_safe" else "ffmpeg_oversampled_alimiter",
            "measurement_engine": "ffmpeg_loudnorm_measurement_only" if preset != "streaming_safe" else None,
            "gain_db": target.get("static_gain_db") if preset == "streaming_safe" else None,
        },
        "limiter": {
            "enabled": preset != "streaming_safe",
            "engine": "ffmpeg_alimiter",
            "requested_oversampling_factor": 4,
            "max_oversampled_rate_hz": 192000,
            "attack_ms": 5.0,
            "release_ms": 80.0,
            "auto_level": False,
            "latency_compensation": True,
            "reason": "explicit_peak_control_without_loudnorm_render_fallback" if preset != "streaming_safe" else "bypass_for_source_preservation",
        },
    }


def _run_ffmpeg(args: list[str], timeout: int = 300) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [FFMPEG_BINARY, "-hide_banner", "-nostdin", *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
        check=False,
    )


def _filter_chain(plan: dict[str, Any]) -> str:
    filters: list[str] = []
    highpass = _number(plan.get("highpass_hz"))
    if highpass is not None and highpass > 0:
        filters.append(f"highpass=f={highpass:.1f}")
    for move in plan.get("eq_moves") or []:
        if not isinstance(move, dict):
            continue
        frequency = _number(move.get("frequency_hz"))
        q = _number(move.get("q"))
        gain = _number(move.get("gain_db"))
        if frequency is None or q is None or gain is None:
            continue
        filters.append(
            f"equalizer=f={frequency:.2f}:width_type=q:width={q:.3f}:g={gain:.3f}"
        )
    resonance = _record(plan.get("resonance"))
    for move in resonance.get("moves") or []:
        if not isinstance(move, dict):
            continue
        frequency = _number(move.get("frequency_hz"))
        detector_q = _number(move.get("detector_q"))
        target_q = _number(move.get("target_q"))
        range_db = _number(move.get("range_db"))
        ratio = _number(move.get("ratio"))
        attack = _number(move.get("attack_ms"))
        release = _number(move.get("release_ms"))
        if None in {frequency, detector_q, target_q, range_db, ratio, attack, release}:
            continue
        filters.append(
            "adynamicequalizer="
            "auto=adaptive:"
            f"dfrequency={frequency:.2f}:dqfactor={detector_q:.3f}:"
            f"tfrequency={frequency:.2f}:tqfactor={target_q:.3f}:"
            f"attack={attack:.1f}:release={release:.1f}:"
            f"ratio={ratio:.3f}:makeup=0:range={range_db:.3f}:"
            "mode=cutabove"
        )
    compression = _record(plan.get("compression"))
    if compression.get("enabled"):
        threshold_db = _number(compression.get("threshold_dbfs")) or -18.0
        threshold_linear = 10.0 ** (threshold_db / 20.0)
        ratio = _number(compression.get("ratio")) or 1.35
        attack = _number(compression.get("attack_ms")) or 20.0
        release = _number(compression.get("release_ms")) or 180.0
        filters.append(
            "acompressor="
            f"threshold={threshold_linear:.6f}:ratio={ratio:.3f}:"
            f"attack={attack:.1f}:release={release:.1f}:makeup=1"
        )
    character = _record(plan.get("character"))
    if character.get("enabled"):
        clip_type = str(character.get("type") or "tanh")
        threshold = _number(character.get("threshold")) or 0.98
        output_level = _number(character.get("output")) or 0.99
        oversample = int(_number(character.get("oversample")) or 4)
        filters.append(
            "asoftclip="
            f"type={clip_type}:threshold={threshold:.6f}:"
            f"output={output_level:.6f}:oversample={oversample}"
        )
    stereo = _record(plan.get("stereo"))
    side_level = _number(stereo.get("side_level"))
    if stereo.get("enabled") and side_level is not None and side_level < 0.999:
        filters.append(f"stereotools=mode=lr>lr:slev={side_level:.6f}")
    return ",".join(filters)


def _render_premaster(
    source: Path,
    output: Path,
    plan: dict[str, Any],
    *,
    sample_rate_hz: int,
) -> None:
    process = _run_ffmpeg([
        "-loglevel", "error", "-y", "-i", str(source), "-vn",
        "-af", _filter_chain(plan) or "anull",
        "-ar", str(sample_rate_hz), "-ac", "2", "-c:a", "pcm_s24le", str(output),
    ])
    if process.returncode != 0:
        raise RuntimeError(f"Premaster DSP failed: {process.stderr[-1200:]}")


def _parse_loudnorm_json(stderr: str) -> dict[str, Any]:
    matches = re.findall(r"\{\s*\"input_i\".*?\}", stderr, flags=re.DOTALL)
    if not matches:
        raise RuntimeError("FFmpeg loudnorm did not return measurement JSON.")
    return json.loads(matches[-1])


def _measure_loudnorm(path: Path, target: dict[str, Any]) -> dict[str, Any]:
    value = (
        f"loudnorm=I={float(target['integrated_lufs']):.2f}:"
        f"TP={float(target['true_peak_dbtp']):.2f}:"
        f"LRA={float(target['max_lra_lu']):.2f}:print_format=json"
    )
    process = _run_ffmpeg([
        "-loglevel", "info", "-i", str(path), "-vn", "-af", value, "-f", "null", "-"
    ])
    if process.returncode != 0:
        raise RuntimeError(f"Loudness measurement failed: {process.stderr[-1200:]}")
    return _parse_loudnorm_json(process.stderr)


def _render_static_gain(
    path: Path,
    output: Path,
    gain_db: float,
    *,
    sample_rate_hz: int,
) -> None:
    filter_value = "anull" if abs(gain_db) < 0.001 else f"volume={gain_db:.3f}dB"
    process = _run_ffmpeg([
        "-loglevel", "error", "-y", "-i", str(path), "-vn",
        "-af", filter_value,
        "-ar", str(sample_rate_hz), "-ac", "2",
        "-c:a", "flac", "-compression_level", "12", "-sample_fmt", "s32",
        "-bits_per_raw_sample", "24",
        str(output),
    ])
    if process.returncode != 0:
        raise RuntimeError(f"Static-gain mastering render failed: {process.stderr[-1200:]}")


def _render_explicit_limiter(
    path: Path,
    output: Path,
    target: dict[str, Any],
    measured: dict[str, Any],
    *,
    sample_rate_hz: int,
) -> dict[str, Any]:
    input_lufs = _number(measured.get("input_i"))
    if input_lufs is None:
        raise RuntimeError("FFmpeg loudness measurement missing input_i.")

    preferred_lufs = float(target["integrated_lufs"])
    loudness_range = _record(target.get("loudness_range"))
    hard_max_gain = _number(loudness_range.get("hard_max_gain_db"))
    if hard_max_gain is None:
        hard_max_gain = 6.0

    requested_gain_db = preferred_lufs - input_lufs
    applied_gain_db = _clamp(requested_gain_db, -12.0, hard_max_gain)
    ceiling_dbtp = float(target["true_peak_dbtp"])
    input_true_peak = _number(measured.get("input_tp"))
    estimated_peak_gain_reduction_db = (
        max(0.0, input_true_peak + applied_gain_db - ceiling_dbtp)
        if input_true_peak is not None
        else None
    )
    limit_linear = 10.0 ** (ceiling_dbtp / 20.0)
    oversampled_rate_hz = min(max(sample_rate_hz * 4, sample_rate_hz), 192000)
    oversampling_factor = oversampled_rate_hz / float(sample_rate_hz)

    filters = [
        f"volume={applied_gain_db:.4f}dB",
        f"aresample={oversampled_rate_hz}",
        (
            "alimiter="
            f"limit={limit_linear:.8f}:attack=5:release=80:"
            "level=false:latency=true"
        ),
        f"aresample={sample_rate_hz}",
    ]
    process = _run_ffmpeg([
        "-loglevel", "error", "-y", "-i", str(path), "-vn",
        "-af", ",".join(filters),
        "-ar", str(sample_rate_hz), "-ac", "2",
        "-c:a", "flac", "-compression_level", "12", "-sample_fmt", "s32",
        "-bits_per_raw_sample", "24",
        str(output),
    ])
    if process.returncode != 0:
        raise RuntimeError(f"Explicit-limiter mastering render failed: {process.stderr[-1200:]}")

    return {
        "engine": "ffmpeg_oversampled_alimiter",
        "measurement_engine": "ffmpeg_loudnorm_measurement_only",
        "input_integrated_lufs": round(input_lufs, 3),
        "requested_gain_db": round(requested_gain_db, 3),
        "applied_gain_db": round(applied_gain_db, 3),
        "hard_max_gain_db": round(hard_max_gain, 3),
        "ceiling_dbtp": round(ceiling_dbtp, 3),
        "estimated_peak_gain_reduction_db": (
            round(estimated_peak_gain_reduction_db, 3)
            if estimated_peak_gain_reduction_db is not None
            else None
        ),
        "oversampled_rate_hz": oversampled_rate_hz,
        "oversampling_factor": round(oversampling_factor, 3),
        "attack_ms": 5.0,
        "release_ms": 80.0,
        "auto_level": False,
        "latency_compensation": True,
    }


def _ensure_storage_envelope(
    output: Path,
    workdir: Path,
    *,
    sample_rate_hz: int = 48000,
    max_bytes: int = MAX_MASTERING_UPLOAD_BYTES,
) -> dict[str, Any]:
    del workdir  # retained in the signature for backward-compatible callers/tests.
    current_size = output.stat().st_size
    effective_chunk_bytes = min(MASTERING_CHUNK_BYTES, max_bytes)
    if current_size <= max_bytes:
        return {
            "profile": "flac_24_native",
            "bit_depth": 24,
            "sample_rate_hz": sample_rate_hz,
            "storage_mode": "single_object",
            "fallback_applied": False,
            "source_precision_preserved": True,
            "file_size": current_size,
            "max_upload_bytes": max_bytes,
            "chunk_size_bytes": None,
            "chunk_count": 1,
        }

    chunk_count = int(math.ceil(current_size / effective_chunk_bytes))
    return {
        "profile": "flac_24_native_chunked",
        "bit_depth": 24,
        "sample_rate_hz": sample_rate_hz,
        "storage_mode": "chunked_lossless",
        "fallback_applied": False,
        "source_precision_preserved": True,
        "file_size": current_size,
        "max_upload_bytes": max_bytes,
        "chunk_size_bytes": effective_chunk_bytes,
        "chunk_count": chunk_count,
    }


def _split_mastering_chunks(
    source: Path,
    workdir: Path,
    *,
    chunk_size_bytes: int = MASTERING_CHUNK_BYTES,
) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    with source.open("rb") as handle:
        index = 0
        offset = 0
        while True:
            payload = handle.read(chunk_size_bytes)
            if not payload:
                break
            path = workdir / f"mastering-part-{index:03d}.bin"
            path.write_bytes(payload)
            chunks.append({
                "index": index,
                "path": path,
                "offset": offset,
                "size": len(payload),
                "sha256": sha256_file(path),
            })
            offset += len(payload)
            index += 1
    return chunks


async def _upload_mastering_output(
    payload: dict[str, Any],
    output: Path,
    result: dict[str, Any],
    workdir: Path,
) -> dict[str, Any]:
    delivery = _record(result.get("delivery"))
    storage_mode = str(delivery.get("storage_mode") or "single_object")
    if storage_mode == "single_object":
        upload_url = str(payload.get("upload_url") or "")
        if not upload_url:
            raise ValueError("upload_url is required for single-object mastering delivery")
        await upload_file(upload_url, output, "audio/flac")
        return {
            "storage_mode": "single_object",
            "chunk_manifest": [],
        }

    chunk_uploads_raw = payload.get("chunk_uploads")
    chunk_uploads = [
        item for item in chunk_uploads_raw
        if isinstance(item, dict)
    ] if isinstance(chunk_uploads_raw, list) else []
    requested_chunk_size = int(_number(delivery.get("chunk_size_bytes")) or MASTERING_CHUNK_BYTES)
    chunks = _split_mastering_chunks(
        output,
        workdir,
        chunk_size_bytes=requested_chunk_size,
    )
    if len(chunks) > len(chunk_uploads):
        raise RuntimeError(
            "The canonical lossless master needs more storage chunks than the "
            f"prepared upload envelope ({len(chunks)} required, {len(chunk_uploads)} available)."
        )

    manifest: list[dict[str, Any]] = []
    for chunk, slot in zip(chunks, chunk_uploads):
        upload_url = str(slot.get("upload_url") or "")
        storage_path = str(slot.get("storage_path") or "")
        if not upload_url or not storage_path:
            raise RuntimeError("A mastering chunk upload slot is incomplete.")
        await upload_file(upload_url, chunk["path"], "application/octet-stream")
        manifest.append({
            "index": chunk["index"],
            "storage_path": storage_path,
            "offset": chunk["offset"],
            "size": chunk["size"],
            "sha256": chunk["sha256"],
        })

    total_size = sum(int(item["size"]) for item in manifest)
    if total_size != output.stat().st_size:
        raise RuntimeError("Chunked mastering upload manifest does not match the canonical file size.")

    return {
        "storage_mode": "chunked_lossless",
        "chunk_manifest": manifest,
    }


def _candidate_checks(
    after: dict[str, Any],
    target: dict[str, Any],
    before: dict[str, Any],
    render_measurement: dict[str, Any] | None = None,
) -> dict[str, Any]:
    loudness = _record(after.get("loudness"))
    peaks = _record(after.get("peaks"))
    dynamics = _record(after.get("dynamics"))
    before_dynamics = _record(before.get("dynamics"))
    integrated = _number(loudness.get("integrated_lufs"))
    true_peak = _number(loudness.get("true_peak_dbtp"))
    clipping = int(_number(peaks.get("clipping_samples")) or 0)
    critical = int(_number(_record(after.get("issue_counts")).get("critical")) or 0)
    before_plr = _number(before_dynamics.get("peak_to_loudness_ratio_lu"))
    after_plr = _number(dynamics.get("peak_to_loudness_ratio_lu"))
    plr_loss = (before_plr - after_plr) if before_plr is not None and after_plr is not None else None

    preserve_source = bool(target.get("preserve_source"))
    loudness_range = _record(target.get("loudness_range"))
    min_lufs = _number(loudness_range.get("min_lufs"))
    max_lufs = _number(loudness_range.get("max_lufs"))
    if preserve_source or min_lufs is None or max_lufs is None:
        loudness_tolerance = 0.35 if preserve_source else 0.75
        loudness_ok = integrated is not None and abs(integrated - float(target["integrated_lufs"])) <= loudness_tolerance
    else:
        loudness_ok = integrated is not None and min_lufs - 0.10 <= integrated <= max_lufs + 0.10

    change_budget = _record(target.get("change_budget"))
    dynamics_tolerance = _number(change_budget.get("max_plr_loss_lu"))
    if dynamics_tolerance is None:
        dynamics_tolerance = 0.75 if preserve_source else 1.75
    peak_ok = true_peak is not None and true_peak <= float(target["true_peak_dbtp"]) + 0.20
    dynamics_ok = plr_loss is None or plr_loss <= dynamics_tolerance
    delta = build_perceptual_delta(before, after, render_measurement)
    budget_evaluation = evaluate_change_budget(
        delta,
        _record(target.get("change_budget")),
    )
    technical_pass = (
        bool(after.get("technical_ready"))
        and critical == 0
        and loudness_ok
        and peak_ok
        and clipping == 0
    )
    creative_pass = bool(budget_evaluation.get("creative_pass")) and dynamics_ok
    return {
        "technical_ready": bool(after.get("technical_ready")) and critical == 0,
        "technical_pass": technical_pass,
        "creative_pass": creative_pass,
        "loudness_in_range": loudness_ok,
        "true_peak_safe": peak_ok and clipping == 0,
        "dynamics_preserved": dynamics_ok,
        "plr_change_lu": round(-plr_loss, 2) if plr_loss is not None else None,
        "perceptual_delta": delta,
        "change_budget": budget_evaluation,
        "pass": technical_pass and creative_pass,
    }


def _render_candidate(
    premaster: Path,
    output: Path,
    music_map: dict[str, Any],
    before: dict[str, Any],
    target: dict[str, Any],
    *,
    include_codec_stress: bool = True,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    source_resolution = _record(target.get("source_resolution"))
    sample_rate_hz = int(_number(source_resolution.get("sample_rate_hz")) or 48000)
    if bool(target.get("preserve_source")):
        gain_db = _number(target.get("static_gain_db")) or 0.0
        _render_static_gain(
            premaster,
            output,
            gain_db,
            sample_rate_hz=sample_rate_hz,
        )
        measured = {
            "engine": "static_gain",
            "gain_db": round(gain_db, 3),
            "sample_rate_hz": sample_rate_hz,
            "reason": "minimum_attenuation_for_true_peak_headroom",
        }
    else:
        loudness_measurement = _measure_loudnorm(premaster, target)
        measured = {
            **loudness_measurement,
            **_render_explicit_limiter(
                premaster,
                output,
                target,
                loudness_measurement,
                sample_rate_hz=sample_rate_hz,
            ),
        }
    after = analyze_mastering(
        output,
        music_map,
        include_codec_stress=include_codec_stress,
        include_section_signatures=include_codec_stress,
    )
    checks = _candidate_checks(after, target, before, measured)
    return measured, after, checks


def master_audio(
    source: Path,
    output: Path,
    *,
    preset: str,
    music_map: dict[str, Any],
    reference_signatures: list[dict[str, Any]],
    artist_preferences: dict[str, Any] | None = None,
    workdir: Path,
) -> dict[str, Any]:
    before = _record(music_map.get("mastering_inspector"))
    if not before:
        before = analyze_mastering(source, music_map)
    target = build_mastering_target(
        preset,
        before,
        reference_signatures,
        artist_preferences,
    )
    plan = build_processing_plan(preset, before, target, reference_signatures)
    source_resolution = _record(target.get("source_resolution"))
    native_sample_rate_hz = int(_number(source_resolution.get("sample_rate_hz")) or 48000)
    premaster = workdir / "premaster.wav"
    if bool(target.get("preserve_source")):
        _render_premaster(
            source,
            premaster,
            plan,
            sample_rate_hz=native_sample_rate_hz,
        )

    iterations: list[dict[str, Any]] = []
    optimizer: dict[str, Any] | None = None

    if bool(target.get("preserve_source")):
        measured, after, checks = _render_candidate(
            premaster,
            output,
            music_map,
            before,
            target,
        )
        iterations.append({
            "iteration": 1,
            "candidate_id": "source_preserving",
            "candidate_role": "recommended",
            "target": dict(target),
            "render_measurement": measured,
            "checks": checks,
        })

        if not checks["pass"]:
            safer_target = dict(target)
            safer_target["true_peak_dbtp"] = round(min(float(target["true_peak_dbtp"]) - 0.5, -1.5), 2)
            safer_true_peak = dict(_record(target.get("true_peak")))
            safer_true_peak["ceiling_dbtp"] = safer_target["true_peak_dbtp"]
            safer_target["true_peak"] = safer_true_peak
            safer_target["static_gain_db"] = round(float(target.get("static_gain_db") or 0.0) - 0.5, 2)
            loudness_shift = -0.5
            safer_target["integrated_lufs"] = round(float(target["integrated_lufs"]) + loudness_shift, 2)
            safer_range = dict(_record(target.get("loudness_range")))
            for key in ("preferred_lufs", "min_lufs", "max_lufs"):
                value = _number(safer_range.get(key))
                if value is not None:
                    safer_range[key] = round(value + loudness_shift, 2)
            safer_target["loudness_range"] = safer_range
            measured, after, checks = _render_candidate(
                premaster,
                output,
                music_map,
                before,
                safer_target,
            )
            iterations.append({
                "iteration": 2,
                "candidate_id": "source_preserving_safer",
                "candidate_role": "safer",
                "target": dict(safer_target),
                "render_measurement": measured,
                "checks": checks,
            })
            target = safer_target
    else:
        rendered_candidates: list[dict[str, Any]] = []
        for index, candidate in enumerate(build_candidate_family(target), start=1):
            candidate_target = _record(candidate.get("target"))
            candidate_role = str(candidate.get("role") or "recommended")
            candidate_plan = build_candidate_processing_plan(plan, candidate_role)
            candidate_premaster = workdir / f"mastering-premaster-{index:02d}.wav"
            candidate_path = workdir / f"mastering-candidate-{index:02d}.flac"
            _render_premaster(
                source,
                candidate_premaster,
                candidate_plan,
                sample_rate_hz=native_sample_rate_hz,
            )
            candidate_measurement, candidate_after, candidate_checks = _render_candidate(
                candidate_premaster,
                candidate_path,
                music_map,
                before,
                candidate_target,
                include_codec_stress=False,
            )
            row = {
                "id": candidate.get("id"),
                "role": candidate_role,
                "reason": candidate.get("reason"),
                "path": candidate_path,
                "plan": candidate_plan,
                "target": candidate_target,
                "measurement": candidate_measurement,
                "after": candidate_after,
                "checks": candidate_checks,
            }
            rendered_candidates.append(row)
            iterations.append({
                "iteration": index,
                "candidate_id": candidate.get("id"),
                "candidate_role": candidate_role,
                "plan": candidate_plan,
                "target": dict(candidate_target),
                "render_measurement": candidate_measurement,
                "checks": candidate_checks,
            })

        optimizer = select_candidate(rendered_candidates)
        selected = _record(optimizer.get("selected"))
        selected_path = selected.get("path")
        if not isinstance(selected_path, Path):
            raise RuntimeError("Candidate optimizer returned no render path.")
        shutil.copyfile(selected_path, output)
        target = _record(selected.get("target"))
        plan = _record(selected.get("plan"))
        measured = _record(selected.get("measurement"))
        # Full verification, including codec stress, is run only on the exact
        # candidate that may be shown/promoted. Intermediate candidates use the
        # deterministic core inspector to keep worker cost bounded.
        after = analyze_mastering(
            output,
            music_map,
            include_section_signatures=True,
        )
        checks = _candidate_checks(after, target, before, measured)
        optimizer = {
            key: value
            for key, value in optimizer.items()
            if key != "selected"
        }
        optimizer["selected_checks_full"] = checks

    delivery = _ensure_storage_envelope(
        output,
        workdir,
        sample_rate_hz=native_sample_rate_hz,
    )
    if delivery["fallback_applied"]:
        after = analyze_mastering(output, music_map)
        checks = _candidate_checks(after, target, before, measured)

    format_info = _record(after.get("format"))
    bit_depth = int(_number(format_info.get("bit_depth")) or delivery["bit_depth"])
    sample_rate_hz = int(_number(format_info.get("sample_rate_hz")) or delivery["sample_rate_hz"])
    channels = int(_number(format_info.get("channels")) or 2)

    return {
        "schema": ACTIVE_MASTERING_SCHEMA,
        "compatibility": {
            "legacy_schema": ACTIVE_MASTERING_LEGACY_SCHEMA,
            "legacy_fields_preserved": True,
        },
        "preset": preset if preset in PRESET_TARGETS else "balanced",
        "target": target,
        "plan": plan,
        "before": before,
        "after": after,
        "iterations": iterations,
        "optimizer": optimizer,
        "delivery": {
            **delivery,
            "container": "FLAC",
            "codec": "FLAC",
            "lossless_codec": True,
            "source_precision_preserved": True,
            "dithered": False,
        },
        "final_checks": checks,
        "output": {
            "container": "FLAC",
            "codec": "FLAC",
            "bit_depth": bit_depth,
            "sample_rate_hz": sample_rate_hz,
            "channels": channels,
            "sha256": sha256_file(output),
            "file_size": output.stat().st_size,
        },
        "notes": [
            "No generative audio is used. Ensemblis adjusts a constrained mastering DSP chain and verifies the rendered waveform.",
            "Streaming-safe mastering uses transparent static attenuation for true-peak headroom instead of squeezing peaks to preserve the original loudness.",
            "Trusted-reference tonal matching is only applied when at least three explicit mastering references exist.",
            "The stored candidate uses lossless 24-bit FLAC at the native sample rate; storage limits never reduce canonical mastering precision.",
            "Creative mastering measures EBU R128 loudness first, then uses explicit oversampled lookahead limiting instead of loudnorm as the final waveform processor.",
            "Canonical renders preserve the source sample rate and use 24-bit PCM-in-FLAC.",
            "When the canonical FLAC exceeds the storage provider's per-object limit, Ensemblis splits the exact file bytes into immutable lossless chunks and serves them through one logical canonical asset URL.",
            "Active Mastering preserves stereo by default and does not perform blind widening or destructive stem remixing.",
        ],
    }


async def _callback(request: MasteringWorkerRequest, status: str, result: dict[str, Any], error: str | None = None) -> None:
    body = {
        "job_id": request.job_id,
        "status": status,
        "result": result,
        "error": error,
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=15.0)) as client:
        response = await client.post(
            request.callback_url,
            json=body,
            headers={
                "Authorization": f"Bearer {request.callback_token}",
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()


async def execute_mastering(request: MasteringWorkerRequest) -> None:
    await _callback(request, "running", {})
    result: dict[str, Any] = {}
    try:
        payload = request.payload
        audio_url = str(payload.get("audio_url") or "")
        upload_url = str(payload.get("upload_url") or "")
        preset = str(payload.get("preset") or "balanced").lower()
        if not audio_url:
            raise ValueError("audio_url is required")
        if not upload_url and not isinstance(payload.get("chunk_uploads"), list):
            raise ValueError("A mastering upload envelope is required")
        music_map = _record(payload.get("music_map"))
        references_raw = payload.get("reference_signatures")
        references = [item for item in references_raw if isinstance(item, dict)] if isinstance(references_raw, list) else []
        artist_preferences = _record(payload.get("artist_mastering_preferences"))

        from tempfile import TemporaryDirectory
        with TemporaryDirectory(prefix="ensemblis-mastering-") as directory:
            workdir = Path(directory)
            source = workdir / "source-audio"
            output = workdir / "mastered.flac"
            await download(audio_url, source)
            result = await asyncio.to_thread(
                master_audio,
                source,
                output,
                preset=preset,
                music_map=music_map,
                reference_signatures=references,
                artist_preferences=artist_preferences,
                workdir=workdir,
            )
            storage_result = await _upload_mastering_output(
                payload,
                output,
                result,
                workdir,
            )
            result["storage"] = storage_result
        await _callback(request, "completed", result)
    except Exception as exc:
        message = str(exc)[:2200] or "Active Mastering failed."
        await _callback(request, "failed", result, message)
