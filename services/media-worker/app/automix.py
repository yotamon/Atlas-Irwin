from __future__ import annotations

import asyncio
import tempfile
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Literal

import httpx
import librosa
import numpy as np
from pydantic import BaseModel, Field

from . import main as worker_main
from .automix_evaluation import evaluate_mixplan
from .automix_manifest import (
    AUTOMATION_VERSION,
    MIXPLAN_VERSION,
    RENDER_ENGINE_CONTRACT_VERSION,
    mixplan_hash,
    validate_mixplan,
)
from .automix_manifest_personalized import build_mixplan
from .automix_mixplan_renderer import render_mixplan
from .automix_model import (
    AUTOMIX_VERSION, MAX_RENDER_MS, MAX_TRACKS, MIN_TRACK_WINDOW_MS, SAMPLE_RATE,
    EnergyProfile, Purpose, TrackDescriptor, TransitionStyle, _energy_from_map,
    _list_records, _record, _safe_float, choose_showcase_window, estimate_key, normalize_dj_bpm,
)
from .automix_planner_personalized import build_set_intelligent_plan
from .mastering_inspector import enrich_music_map_with_mastering
from .music_intelligence_v4_runtime import analyze_music as analyze_music_v4

RENDERER_VERSION = "ensemblis.media-worker.automix.v1"


class AutomixWorkerRequest(BaseModel):
    job_id: str
    job_type: Literal["render_automix"]
    payload: dict[str, Any] = Field(default_factory=dict)
    callback_url: str
    callback_token: str


async def _standardize(url: str, target: Path, workdir: Path, index: int) -> None:
    source = workdir / f"automix-{index:02d}.source"
    await worker_main.download(url, source)
    await worker_main.ffmpeg(
        "-i", str(source), "-vn", "-ac", "2", "-ar", str(SAMPLE_RATE),
        "-c:a", "pcm_f32le", str(target),
    )


async def _upload_streaming(upload_url: str, path: Path, content_type: str) -> None:
    """Upload large AutoMix renders without materializing the entire file in memory."""
    worker_main.validate_remote_url(upload_url)
    file_size = path.stat().st_size

    async def chunks():
        with path.open("rb") as handle:
            while True:
                chunk = await asyncio.to_thread(handle.read, 1024 * 1024)
                if not chunk:
                    break
                yield chunk

    async with httpx.AsyncClient(timeout=httpx.Timeout(900.0, connect=20.0)) as client:
        response = await client.put(
            upload_url,
            content=chunks(),
            headers={
                "content-type": content_type,
                "content-length": str(file_size),
                "cache-control": "max-age=31536000",
                "x-upsert": "false",
            },
        )
        response.raise_for_status()


def _attach_transition_evidence(music_map: dict[str, Any], raw: dict[str, Any]) -> dict[str, Any]:
    result = dict(music_map)
    stem_intelligence = _record(raw.get("stem_intelligence"))
    if stem_intelligence:
        result["automix_stem_intelligence"] = stem_intelligence
    vocals = raw.get("vocal_activity_curve")
    if isinstance(vocals, list):
        result["automix_vocals_activity_curve"] = vocals
    bass = raw.get("bass_activity_curve")
    if isinstance(bass, list):
        result["automix_bass_activity_curve"] = bass
    return result


def _source_fingerprints(raw_tracks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    fingerprints: list[dict[str, Any]] = []
    for raw in raw_tracks:
        music_map = _record(raw.get("music_map"))
        source_audio = _record(music_map.get("source_audio"))
        fingerprints.append({
            "track_id": str(raw.get("id") or ""),
            "audio_url": str(raw.get("audio_url") or ""),
            "media_asset_id": raw.get("media_asset_id"),
            "analysis_version": music_map.get("analysis_version") or music_map.get("version"),
            "source_audio_url": source_audio.get("url"),
        })
    return fingerprints


def _validate_approved_mixplan_sources(manifest: dict[str, Any], raw_tracks: list[dict[str, Any]]) -> None:
    provenance = _record(manifest.get("provenance"))
    expected = _list_records(provenance.get("source_fingerprints"))
    current = {
        str(item.get("id") or ""): str(item.get("audio_url") or "")
        for item in raw_tracks
        if str(item.get("id") or "")
    }
    expected_map = {
        str(item.get("track_id") or ""): str(item.get("audio_url") or "")
        for item in expected
        if str(item.get("track_id") or "")
    }
    if not expected_map or expected_map != current:
        raise ValueError("Approved MixPlan source fingerprints no longer match the canonical candidate pool")


async def prepare_tracks(payload_tracks: list[dict[str, Any]], workdir: Path, purpose: Purpose, target_duration_ms: int) -> list[TrackDescriptor]:
    if not 2 <= len(payload_tracks) <= MAX_TRACKS:
        raise ValueError(f"AutoMix requires 2-{MAX_TRACKS} tracks")
    desired = max(MIN_TRACK_WINDOW_MS, int(target_duration_ms / len(payload_tracks)) + 16_000)
    tracks: list[TrackDescriptor] = []
    for index, raw in enumerate(payload_tracks):
        url = str(raw.get("audio_url") or "")
        track_id = str(raw.get("id") or f"track-{index + 1}")
        title = str(raw.get("title") or f"Track {index + 1}")
        if not url:
            raise ValueError(f"AutoMix track {track_id} is missing audio_url")
        target = workdir / f"automix-{index:02d}.wav"
        await _standardize(url, target, workdir, index)
        music_map = _record(raw.get("music_map"))
        if not music_map or int(music_map.get("duration_ms") or 0) <= 0:
            source_audio = {"url": url, "media_asset_id": raw.get("media_asset_id")}
            music_map = await asyncio.to_thread(analyze_music_v4, target, source_audio)
        music_map = _attach_transition_evidence(music_map, raw)
        if not _record(music_map.get("mastering_inspector")) or not _record(music_map.get("beat_stability")):
            music_map = await asyncio.to_thread(enrich_music_map_with_mastering, music_map, target)

        bpm = _safe_float(music_map.get("bpm"), 0.0)
        if bpm <= 0:
            beat_stability = _record(music_map.get("beat_stability"))
            bpm = _safe_float(beat_stability.get("median_bpm"), 0.0)
        if bpm <= 0:
            y, sr = librosa.load(target, sr=22050, mono=True, duration=300.0, res_type="soxr_hq")
            tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
            bpm = _safe_float(np.asarray(tempo).reshape(-1)[0], 120.0)
        key = await asyncio.to_thread(estimate_key, target)
        duration = int(music_map.get("duration_ms") or 0)
        start, end, window_score = choose_showcase_window(music_map, desired, purpose)
        qc = _record(music_map.get("master_qc"))
        lufs_raw = qc.get("integrated_lufs")
        lufs = _safe_float(lufs_raw) if isinstance(lufs_raw, (int, float)) else None
        tracks.append(TrackDescriptor(
            id=track_id, title=title, url=url, path=target, music_map=music_map,
            duration_ms=duration, bpm=bpm, dj_bpm=normalize_dj_bpm(bpm), key=key,
            energy=_energy_from_map(music_map), loudness_lufs=lufs,
            window_start_ms=start, window_end_ms=end, window_score=window_score,
        ))
    return tracks


PlanCallback = Callable[[dict[str, Any]], Awaitable[None]]


def _plan_warnings(plan: dict[str, Any]) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    for item in _list_records(plan.get("tracks")):
        mastering = _record(item.get("mastering"))
        tempo = _record(item.get("tempo"))
        if not bool(mastering.get("technical_ready", True)):
            warnings.append({
                "track_id": item.get("track_id"),
                "code": "source_master_review",
                "message": "Source master contains technical issues; AutoMix will use conservative gain staging and will not attempt destructive repair.",
            })
        if str(tempo.get("classification") or "") in {"drifting", "section_tempo_changes", "unstable"}:
            warnings.append({
                "track_id": item.get("track_id"),
                "code": "variable_tempo",
                "classification": tempo.get("classification"),
                "message": "Transition planning used local tempo evidence and avoided forcing unsafe fixed-grid sync.",
            })
    return warnings


def _engine_metadata(execution_mode: str) -> dict[str, Any]:
    return {
        "version": AUTOMIX_VERSION,
        "renderer_version": RENDERER_VERSION,
        "mixplan_version": MIXPLAN_VERSION,
        "transition_automation_version": AUTOMATION_VERSION,
        "render_engine_contract_version": RENDER_ENGINE_CONTRACT_VERSION,
        "execution_mode": execution_mode,
        "render_contract": "validated_mixplan_only",
        "set_intelligence": "duration-aware candidate curation + bounded personal DJ profile + durable plan directives",
        "time_stretch": "Signalsmith Stretch via python-stretch",
        "pitch_shift": "disabled",
        "mastering_analysis": "Ensemblis Mastering Inspector",
        "tempo_strategy": "local tempo evidence; unstable tempo is never forced to a constant grid",
        "loudness_strategy": "selected-window channel gain plus two-pass final mix loudness normalization",
        "quality_mode": "offline_high_quality",
    }


def _execution_metrics(
    started_at: float,
    *,
    execution_mode: str,
    source_track_count: int,
    output_duration_ms: int = 0,
    output_bytes: int = 0,
) -> dict[str, Any]:
    wall_ms = max(0, int(round((time.perf_counter() - started_at) * 1000)))
    realtime_factor = round(wall_ms / output_duration_ms, 4) if output_duration_ms > 0 else None
    return {
        "version": "ensemblis.automix-execution-metrics.v1",
        "scope": "source_preparation+planning+render+encode+upload" if execution_mode != "plan_only" else "source_preparation+planning",
        "execution_mode": execution_mode,
        "wall_time_ms": wall_ms,
        "output_duration_ms": output_duration_ms or None,
        "realtime_factor": realtime_factor,
        "source_track_count": source_track_count,
        "output_bytes": output_bytes or None,
    }


def _qa_diagnostics(
    plan: dict[str, Any],
    mixplan: dict[str, Any],
    warnings: list[dict[str, Any]],
    render_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    transitions = _list_records(mixplan.get("transitions"))
    tracks = _list_records(mixplan.get("tracks"))
    provenance = _record(mixplan.get("provenance"))
    risk_flag_count = sum(len(item.get("risk_flags")) for item in transitions if isinstance(item.get("risk_flags"), list))
    low_confidence = sum(1 for item in transitions if _safe_float(item.get("confidence"), 0.5) < 0.6)
    stretch_deltas = [
        abs(_safe_float(_record(item.get("playback")).get("time_factor"), 1.0) - 1.0)
        for item in tracks
    ]
    render = render_meta or {}
    return {
        "version": "ensemblis.automix-qa.v1",
        "plan_hash": str(mixplan.get("plan_hash") or ""),
        "transition_count": len(transitions),
        "low_confidence_transition_count": low_confidence,
        "risk_flag_count": risk_flag_count,
        "warning_count": len(warnings),
        "max_abs_stretch_delta": round(max(stretch_deltas, default=0.0), 6),
        "source_fingerprint_count": len(_list_records(provenance.get("source_fingerprints"))),
        "quality_summary": _record(plan.get("quality_summary")),
        "output_duration_ms": int(render.get("duration_ms") or 0) or None,
        "final_measured_lufs": render.get("final_measured_lufs"),
        "ceiling_dbtp": render.get("ceiling_dbtp"),
    }


async def automix_job(
    payload: dict[str, Any],
    workdir: Path,
    on_plan: PlanCallback | None = None,
) -> dict[str, Any]:
    started_at = time.perf_counter()
    raw_tracks = _list_records(payload.get("tracks"))
    purpose = str(payload.get("purpose") or "booking")
    profile = str(payload.get("energy_profile") or "dynamic")
    style = str(payload.get("transition_style") or "dj")
    execution_mode = str(payload.get("execution_mode") or "render")
    if execution_mode not in {"render", "plan_only", "approved_render"}:
        raise ValueError("Unsupported AutoMix execution mode")
    if purpose not in {"booking", "soundcloud", "journey", "peak_time", "warm_up", "discovery"}:
        raise ValueError("Unsupported AutoMix purpose")
    if profile not in {"smooth", "dynamic", "peak"}:
        raise ValueError("Unsupported AutoMix energy profile")
    if style not in {"clean", "dj", "creative"}:
        raise ValueError("Unsupported AutoMix transition style")
    target_duration_ms = max(2 * MIN_TRACK_WINDOW_MS, min(MAX_RENDER_MS, int(payload.get("duration_ms") or 20 * 60 * 1000)))

    output_format = str(payload.get("output_format") or "mp3").lower()
    if output_format not in {"wav", "mp3"}:
        raise ValueError("AutoMix output_format must be wav or mp3")
    upload_url = str(payload.get("upload_url") or "")
    if execution_mode != "plan_only":
        if not upload_url:
            raise ValueError("AutoMix upload_url is required for rendering")
        worker_main.validate_remote_url(upload_url)

    tracks = await prepare_tracks(raw_tracks, workdir, purpose, target_duration_ms)  # type: ignore[arg-type]
    source_fingerprints = _source_fingerprints(raw_tracks)

    if execution_mode == "approved_render":
        mixplan = _record(payload.get("approved_mixplan"))
        if not mixplan:
            raise ValueError("Approved render requires a frozen MixPlan")
        validate_mixplan(mixplan)
        expected_hash = str(mixplan.get("plan_hash") or "")
        if not expected_hash or expected_hash != mixplan_hash(mixplan):
            raise ValueError("Approved MixPlan hash does not match its canonical instructions")
        _validate_approved_mixplan_sources(mixplan, raw_tracks)
        evaluation = evaluate_mixplan(mixplan)
        plan = {
            **mixplan,
            "render_manifest": mixplan,
            "evaluation": evaluation,
            "approved_for_render": True,
        }
        published_plan = plan
    else:
        plan = build_set_intelligent_plan(
            tracks,
            purpose,  # type: ignore[arg-type]
            profile,  # type: ignore[arg-type]
            style,  # type: ignore[arg-type]
            target_duration_ms,
            set_intent=_record(payload.get("set_intent")),
            dj_profile=_record(payload.get("dj_profile")),
            plan_directives=_record(payload.get("plan_directives")),
        )
        plan["plan_lineage"] = _record(payload.get("plan_lineage"))
        mixplan = build_mixplan(plan, source_fingerprints=source_fingerprints)
        evaluation = evaluate_mixplan(mixplan)
        published_plan = {**plan, "render_manifest": mixplan, "evaluation": evaluation}

    if on_plan is not None:
        await on_plan(published_plan)

    warnings = _plan_warnings(published_plan)
    if execution_mode == "plan_only":
        return {
            "uploaded": False,
            "phase": "planned",
            "plan": published_plan,
            "render_manifest": mixplan,
            "evaluation": evaluation,
            "warnings": warnings,
            "engine": _engine_metadata(execution_mode),
            "execution_metrics": _execution_metrics(
                started_at,
                execution_mode=execution_mode,
                source_track_count=len(raw_tracks),
            ),
            "qa_diagnostics": _qa_diagnostics(published_plan, mixplan, warnings),
        }

    wav_path, render_meta = await asyncio.to_thread(render_mixplan, tracks, mixplan, workdir)
    if output_format == "wav":
        output_path = wav_path
        mime_type = "audio/wav"
    else:
        output_path = workdir / "automix.mp3"
        output_sr = str(int(render_meta.get("sample_rate") or 48000))
        await worker_main.ffmpeg(
            "-i", str(wav_path), "-c:a", "libmp3lame", "-b:a", "320k", "-ar", output_sr, str(output_path),
        )
        mime_type = "audio/mpeg"
    await _upload_streaming(upload_url, output_path, mime_type)
    sha256 = await asyncio.to_thread(worker_main.sha256_file, output_path)
    file_size = output_path.stat().st_size
    output_duration_ms = int(render_meta.get("duration_ms") or 0)
    return {
        "uploaded": True,
        "file_size": file_size,
        "mime_type": mime_type,
        "sha256": sha256,
        "output": {"file_size": file_size, "mime_type": mime_type, "sha256": sha256},
        "phase": "complete",
        "plan": published_plan,
        "render_manifest": mixplan,
        "evaluation": evaluation,
        "render": render_meta,
        "warnings": warnings,
        "engine": _engine_metadata(execution_mode),
        "execution_metrics": _execution_metrics(
            started_at,
            execution_mode=execution_mode,
            source_track_count=len(raw_tracks),
            output_duration_ms=output_duration_ms,
            output_bytes=file_size,
        ),
        "qa_diagnostics": _qa_diagnostics(published_plan, mixplan, warnings, render_meta),
    }


async def execute_automix(request: AutomixWorkerRequest) -> str:
    execution_mode = str(request.payload.get("execution_mode") or "render")
    await worker_main.callback(request, "running", result={"phase": "preparing_sources"})  # type: ignore[arg-type]
    try:
        with tempfile.TemporaryDirectory(prefix="ensemblis-automix-") as directory:
            async def publish_plan(plan: dict[str, Any]) -> None:
                await worker_main.callback(
                    request,
                    "running",
                    result={
                        "phase": "plan_ready" if execution_mode == "plan_only" else "rendering",
                        "plan": plan,
                    },
                )  # type: ignore[arg-type]

            result = await automix_job(request.payload, Path(directory), on_plan=publish_plan)
    except Exception as exc:
        await worker_main.callback(request, "failed", error=str(exc)[:4000])  # type: ignore[arg-type]
        return "failed"
    await worker_main.callback(request, "completed", result=result)  # type: ignore[arg-type]
    return "completed"
