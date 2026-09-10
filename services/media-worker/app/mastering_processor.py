from __future__ import annotations

import asyncio
import json
import math
import re
import subprocess
from pathlib import Path
from statistics import median
from typing import Any, Literal

import httpx
import imageio_ffmpeg
from pydantic import BaseModel, Field

from .main import download, sha256_file, upload_file
from .mastering_inspector import analyze_mastering

ACTIVE_MASTERING_SCHEMA = "ensemblis.active_mastering.v1"
FFMPEG_BINARY = imageio_ffmpeg.get_ffmpeg_exe()

PRESET_TARGETS: dict[str, dict[str, float]] = {
    "balanced": {"integrated_lufs": -10.0, "true_peak_dbtp": -1.2, "compression_ratio": 1.35},
    "punchy": {"integrated_lufs": -9.0, "true_peak_dbtp": -1.2, "compression_ratio": 1.5},
    "dynamic": {"integrated_lufs": -11.5, "true_peak_dbtp": -1.3, "compression_ratio": 1.0},
}
BAND_EQ = {
    "sub_20_80": (55.0, 0.8),
    "bass_80_180": (120.0, 0.9),
    "low_mid_180_500": (320.0, 1.0),
    "mid_500_2500": (1200.0, 1.0),
    "presence_2500_6000": (4200.0, 1.0),
    "air_6000_16000": (10500.0, 0.8),
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


def _catalog_median(signatures: list[dict[str, Any]], key: str) -> float | None:
    values = [_number(item.get(key)) for item in signatures]
    clean = [item for item in values if item is not None]
    return float(median(clean)) if clean else None


def _catalog_band_medians(signatures: list[dict[str, Any]]) -> dict[str, float]:
    result: dict[str, float] = {}
    for key in BAND_EQ:
        values = [
            _number(_record(signature.get("band_relative_db")).get(key))
            for signature in signatures
        ]
        clean = [item for item in values if item is not None]
        if clean:
            result[key] = float(median(clean))
    return result


def build_mastering_target(
    preset: str,
    source_inspector: dict[str, Any],
    reference_signatures: list[dict[str, Any]],
) -> dict[str, Any]:
    selected = PRESET_TARGETS.get(preset, PRESET_TARGETS["balanced"])
    valid_refs = [
        item for item in reference_signatures
        if isinstance(item, dict) and _number(item.get("integrated_lufs")) is not None
    ]
    catalog_lufs = _catalog_median(valid_refs, "integrated_lufs")
    target_lufs = selected["integrated_lufs"]
    reference_source = "preset"
    if catalog_lufs is not None and len(valid_refs) >= 3:
        target_lufs = _clamp((target_lufs * 0.55) + (catalog_lufs * 0.45), -13.0, -8.5)
        reference_source = "artist_catalog"

    codec_rows = source_inspector.get("codec_stress") or []
    codec_risk = any(
        isinstance(item, dict)
        and item.get("status") == "completed"
        and bool(item.get("very_low_headroom"))
        for item in codec_rows
    )
    true_peak = selected["true_peak_dbtp"]
    if codec_risk:
        true_peak = min(true_peak, -1.8)

    source_dynamics = _record(source_inspector.get("dynamics"))
    source_lra = _number(source_dynamics.get("loudness_range_lu"))
    max_lra = _clamp(max(source_lra or 0.0, 11.0), 7.0, 18.0)

    return {
        "preset": preset if preset in PRESET_TARGETS else "balanced",
        "integrated_lufs": round(target_lufs, 2),
        "true_peak_dbtp": round(true_peak, 2),
        "max_lra_lu": round(max_lra, 2),
        "reference_source": reference_source,
        "reference_count": len(valid_refs),
        "catalog_integrated_lufs": round(catalog_lufs, 2) if catalog_lufs is not None else None,
        "codec_headroom_guard": codec_risk,
    }


def build_processing_plan(
    preset: str,
    source_inspector: dict[str, Any],
    target: dict[str, Any],
    reference_signatures: list[dict[str, Any]],
) -> dict[str, Any]:
    source_signature = _record(source_inspector.get("reference_signature"))
    current_bands = _record(source_signature.get("band_relative_db"))
    reference_bands = _catalog_band_medians(reference_signatures) if target.get("reference_source") == "artist_catalog" else {}

    eq_moves: list[dict[str, Any]] = []
    for key, (frequency_hz, q) in BAND_EQ.items():
        current = _number(current_bands.get(key))
        reference = _number(reference_bands.get(key))
        if current is None or reference is None:
            continue
        gain_db = _clamp((reference - current) * 0.35, -1.5, 1.5)
        if abs(gain_db) < 0.25:
            continue
        eq_moves.append({
            "band": key,
            "frequency_hz": frequency_hz,
            "q": q,
            "gain_db": round(gain_db, 2),
            "reason": "artist_catalog_tonal_alignment",
        })

    dynamics = _record(source_inspector.get("dynamics"))
    plr = _number(dynamics.get("peak_to_loudness_ratio_lu"))
    crest = _number(dynamics.get("crest_factor_db"))
    ratio = PRESET_TARGETS.get(preset, PRESET_TARGETS["balanced"])["compression_ratio"]
    compression_enabled = (
        preset != "dynamic"
        and ratio > 1.0
        and (plr is None or plr > 10.5)
        and (crest is None or crest > 9.5)
    )

    issues = source_inspector.get("issues") or []
    phase_risk = any(
        isinstance(item, dict) and item.get("code") in {"phase_risk", "localized_mono_loss"}
        for item in issues
    )

    return {
        "schema": ACTIVE_MASTERING_SCHEMA,
        "eq_moves": eq_moves,
        "highpass_hz": 20.0,
        "compression": {
            "enabled": compression_enabled,
            "threshold_dbfs": -18.0,
            "ratio": ratio if compression_enabled else 1.0,
            "attack_ms": 20.0,
            "release_ms": 180.0,
            "reason": "gentle_glue_only_when_dynamic_headroom_exists" if compression_enabled else "preserve_existing_dynamics",
        },
        "stereo": {
            "mode": "preserve",
            "phase_risk_detected": phase_risk,
            "note": "Active v1 never applies blind stereo widening or low-end narrowing.",
        },
        "loudness": {
            "integrated_lufs": target["integrated_lufs"],
            "true_peak_dbtp": target["true_peak_dbtp"],
            "max_lra_lu": target["max_lra_lu"],
            "engine": "ffmpeg_loudnorm_two_pass",
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
    filters: list[str] = [f"highpass=f={float(plan.get('highpass_hz') or 20.0):.1f}"]
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
    return ",".join(filters)


def _render_premaster(source: Path, output: Path, plan: dict[str, Any]) -> None:
    process = _run_ffmpeg([
        "-loglevel", "error", "-y", "-i", str(source), "-vn",
        "-af", _filter_chain(plan),
        "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le", str(output),
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


def _render_loudnorm(path: Path, output: Path, target: dict[str, Any], measured: dict[str, Any]) -> None:
    def required(key: str) -> float:
        value = _number(measured.get(key))
        if value is None:
            raise RuntimeError(f"FFmpeg loudnorm measurement missing {key}.")
        return value

    loudnorm = (
        f"loudnorm=I={float(target['integrated_lufs']):.2f}:"
        f"TP={float(target['true_peak_dbtp']):.2f}:"
        f"LRA={float(target['max_lra_lu']):.2f}:"
        f"measured_I={required('input_i'):.3f}:"
        f"measured_TP={required('input_tp'):.3f}:"
        f"measured_LRA={required('input_lra'):.3f}:"
        f"measured_thresh={required('input_thresh'):.3f}:"
        f"offset={required('target_offset'):.3f}:"
        "linear=true:print_format=summary"
    )
    process = _run_ffmpeg([
        "-loglevel", "error", "-y", "-i", str(path), "-vn",
        "-af", loudnorm,
        "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le", str(output),
    ])
    if process.returncode != 0:
        raise RuntimeError(f"Final loudness render failed: {process.stderr[-1200:]}")


def _candidate_checks(after: dict[str, Any], target: dict[str, Any], before: dict[str, Any]) -> dict[str, Any]:
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

    loudness_ok = integrated is not None and abs(integrated - float(target["integrated_lufs"])) <= 0.75
    peak_ok = true_peak is not None and true_peak <= float(target["true_peak_dbtp"]) + 0.20
    dynamics_ok = plr_loss is None or plr_loss <= 1.75
    return {
        "technical_ready": bool(after.get("technical_ready")) and critical == 0,
        "loudness_in_range": loudness_ok,
        "true_peak_safe": peak_ok and clipping == 0,
        "dynamics_preserved": dynamics_ok,
        "plr_change_lu": round(-plr_loss, 2) if plr_loss is not None else None,
        "pass": bool(after.get("technical_ready")) and critical == 0 and loudness_ok and peak_ok and clipping == 0 and dynamics_ok,
    }


def _render_candidate(
    premaster: Path,
    output: Path,
    music_map: dict[str, Any],
    before: dict[str, Any],
    target: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    measured = _measure_loudnorm(premaster, target)
    _render_loudnorm(premaster, output, target, measured)
    after = analyze_mastering(output, music_map)
    checks = _candidate_checks(after, target, before)
    return measured, after, checks


def master_audio(
    source: Path,
    output: Path,
    *,
    preset: str,
    music_map: dict[str, Any],
    reference_signatures: list[dict[str, Any]],
    workdir: Path,
) -> dict[str, Any]:
    before = _record(music_map.get("mastering_inspector"))
    if not before:
        before = analyze_mastering(source, music_map)
    target = build_mastering_target(preset, before, reference_signatures)
    plan = build_processing_plan(preset, before, target, reference_signatures)
    premaster = workdir / "premaster.wav"
    _render_premaster(source, premaster, plan)

    iterations: list[dict[str, Any]] = []
    measured, after, checks = _render_candidate(premaster, output, music_map, before, target)
    iterations.append({
        "iteration": 1,
        "target": dict(target),
        "loudnorm_measurement": measured,
        "checks": checks,
    })

    if not checks["pass"]:
        safer_target = dict(target)
        safer_target["true_peak_dbtp"] = round(min(float(target["true_peak_dbtp"]) - 0.5, -1.5), 2)
        if not checks["loudness_in_range"] or not checks["dynamics_preserved"]:
            safer_target["integrated_lufs"] = round(float(target["integrated_lufs"]) - 0.35, 2)
        measured, after, checks = _render_candidate(premaster, output, music_map, before, safer_target)
        iterations.append({
            "iteration": 2,
            "target": dict(safer_target),
            "loudnorm_measurement": measured,
            "checks": checks,
        })
        target = safer_target

    return {
        "schema": ACTIVE_MASTERING_SCHEMA,
        "preset": preset if preset in PRESET_TARGETS else "balanced",
        "target": target,
        "plan": plan,
        "before": before,
        "after": after,
        "iterations": iterations,
        "final_checks": checks,
        "output": {
            "container": "WAV",
            "codec": "PCM",
            "bit_depth": 24,
            "sample_rate_hz": 48000,
            "channels": 2,
            "sha256": sha256_file(output),
            "file_size": output.stat().st_size,
        },
        "notes": [
            "No generative audio is used. Ensemblis adjusts a constrained mastering DSP chain and verifies the rendered waveform.",
            "Artist-catalog tonal matching is only applied when at least three analyzed catalog references exist.",
            "Active v1 preserves stereo by default and does not perform blind widening or destructive stem remixing.",
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
    try:
        payload = request.payload
        audio_url = str(payload.get("audio_url") or "")
        upload_url = str(payload.get("upload_url") or "")
        preset = str(payload.get("preset") or "balanced").lower()
        if not audio_url:
            raise ValueError("audio_url is required")
        if not upload_url:
            raise ValueError("upload_url is required")
        music_map = _record(payload.get("music_map"))
        references_raw = payload.get("reference_signatures")
        references = [item for item in references_raw if isinstance(item, dict)] if isinstance(references_raw, list) else []

        from tempfile import TemporaryDirectory
        with TemporaryDirectory(prefix="ensemblis-mastering-") as directory:
            workdir = Path(directory)
            source = workdir / "source-audio"
            output = workdir / "mastered.wav"
            await download(audio_url, source)
            result = await asyncio.to_thread(
                master_audio,
                source,
                output,
                preset=preset,
                music_map=music_map,
                reference_signatures=references,
                workdir=workdir,
            )
            await upload_file(upload_url, output, "audio/wav")
        await _callback(request, "completed", result)
    except Exception as exc:
        message = str(exc)[:2200] or "Active Mastering failed."
        await _callback(request, "failed", {}, message)
