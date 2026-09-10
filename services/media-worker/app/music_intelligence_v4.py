from __future__ import annotations

import importlib.util
import math
import os
from pathlib import Path
from typing import Any

import librosa
import numpy as np
import soundfile as sf

from .music_intelligence import MOMENT_INTENTS, SOCIAL_DURATIONS_MS, analyze_music as analyze_music_v3

ANALYSIS_VERSION = 4
ANALYSIS_CONFIG = "atlas-ti-v4.0.0"
TIMELINE_VERSION = "atlas.musical_timeline.v1"
MAX_PRIMARY_MOMENTS = 5


def _clip01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _overlap_ms(a_start: int, a_end: int, b_start: int, b_end: int) -> int:
    return max(0, min(a_end, b_end) - max(a_start, b_start))


def _overlap_ratio(a: dict[str, Any], b: dict[str, Any]) -> float:
    overlap = _overlap_ms(int(a["start_ms"]), int(a["end_ms"]), int(b["start_ms"]), int(b["end_ms"]))
    shortest = max(1, min(int(a["end_ms"]) - int(a["start_ms"]), int(b["end_ms"]) - int(b["start_ms"])))
    return overlap / shortest


def _weighted_evidence(start_ms: int, end_ms: int, candidates: list[dict[str, Any]]) -> tuple[dict[str, float], dict[str, float], list[dict[str, Any]]]:
    metrics: dict[str, float] = {}
    intents = {intent: 0.0 for intent in MOMENT_INTENTS}
    sources: list[dict[str, Any]] = []
    total = 0.0
    duration = max(1, end_ms - start_ms)
    for candidate in candidates:
        c_start, c_end = int(candidate.get("start_ms") or 0), int(candidate.get("end_ms") or 0)
        overlap = _overlap_ms(start_ms, end_ms, c_start, c_end)
        if overlap <= 0:
            continue
        weight = min(overlap / max(1, c_end - c_start), overlap / duration)
        if weight < 0.15:
            continue
        total += weight
        for key, value in (candidate.get("metrics") or {}).items():
            if isinstance(value, (int, float)):
                metrics[key] = metrics.get(key, 0.0) + float(value) * weight
        for intent in MOMENT_INTENTS:
            value = (candidate.get("intent_scores") or {}).get(intent)
            if isinstance(value, (int, float)):
                intents[intent] += float(value) * weight
        sources.append({"candidate_id": candidate.get("id"), "overlap": round(weight, 4), "score": candidate.get("score")})
    if total:
        metrics = {key: _clip01(value / total) for key, value in metrics.items()}
        intents = {key: _clip01(value / total) for key, value in intents.items()}
    sources.sort(key=lambda item: -float(item["overlap"]))
    return metrics, intents, sources[:5]


def _boundary_strength(ms: int, v3: dict[str, Any]) -> tuple[float, list[str]]:
    evidence: list[tuple[float, str]] = []
    for section in v3.get("sections") or []:
        if not isinstance(section, dict):
            continue
        confidence = float(section.get("confidence") or section.get("boundary_confidence") or 0.45)
        if abs(ms - int(section.get("start_ms") or 0)) <= 120 or abs(ms - int(section.get("end_ms") or 0)) <= 120:
            evidence.append((_clip01(0.9 * confidence + 0.08), "section_boundary"))
    for phrase in v3.get("phrases") or []:
        if not isinstance(phrase, dict):
            continue
        if abs(ms - int(phrase.get("start_ms") or 0)) <= 120 or abs(ms - int(phrase.get("end_ms") or 0)) <= 120:
            evidence.append((_clip01(0.78 * float(phrase.get("confidence") or 0.5) + 0.14), "phrase_boundary"))
    downbeat_source = str(v3.get("downbeat_source") or "none")
    if any(abs(ms - int(value)) <= 90 for value in v3.get("downbeats_ms") or []):
        evidence.append((0.97 if downbeat_source == "model" else 0.66, "downbeat"))
    if any(abs(ms - int(bar.get("start_ms") or 0)) <= 90 for bar in v3.get("bars") or [] if isinstance(bar, dict)):
        evidence.append((0.9 if downbeat_source == "model" else 0.62, "bar_boundary"))
    if not evidence:
        return 0.25, ["free_time"]
    miss = 1.0
    for value, _ in evidence:
        miss *= 1.0 - value
    return _clip01(1.0 - miss), sorted({label for _, label in evidence})


def _section_for(start_ms: int, end_ms: int, v3: dict[str, Any]) -> dict[str, Any] | None:
    midpoint = start_ms + (end_ms - start_ms) // 2
    return next((section for section in v3.get("sections") or [] if isinstance(section, dict) and int(section.get("start_ms") or 0) <= midpoint < int(section.get("end_ms") or 0)), None)


def _musical_units(v3: dict[str, Any]) -> list[dict[str, Any]]:
    duration_ms = int(v3.get("duration_ms") or 0)
    phrases = [item for item in v3.get("phrases") or [] if isinstance(item, dict)]
    sections = [item for item in v3.get("sections") or [] if isinstance(item, dict)]
    legacy = [item for item in v3.get("hook_candidates") or [] if isinstance(item, dict)]
    raw: list[tuple[str, str, int, int, float]] = []

    for phrase in phrases:
        start, end = int(phrase.get("start_ms") or 0), int(phrase.get("end_ms") or 0)
        if 3000 <= end - start <= 45000:
            raw.append((str(phrase.get("id") or f"phrase-{start}"), "phrase", start, end, float(phrase.get("confidence") or 0.5)))
    for left, right in zip(phrases[:-1], phrases[1:]):
        if left.get("section_id") != right.get("section_id"):
            continue
        start, end = int(left.get("start_ms") or 0), int(right.get("end_ms") or 0)
        if 6500 <= end - start <= 45000:
            raw.append((f"{left.get('id') or start}+{right.get('id') or end}", "phrase_pair", start, end, min(float(left.get("confidence") or 0.5), float(right.get("confidence") or 0.5))))
    for section in sections:
        start, end = int(section.get("start_ms") or 0), min(duration_ms, int(section.get("end_ms") or duration_ms))
        if 4000 <= end - start <= 45000:
            raw.append((str(section.get("id") or f"section-{start}"), "section", start, end, float(section.get("confidence") or 0.45)))
    if not raw:
        for candidate in legacy[:12]:
            start, end = int(candidate.get("start_ms") or 0), int(candidate.get("end_ms") or 0)
            if end > start:
                raw.append((str(candidate.get("id") or f"window-{start}"), "legacy_window", start, end, float((candidate.get("metrics") or {}).get("segment_confidence") or 0.35)))

    priority = {"phrase_pair": 4, "phrase": 3, "section": 2, "legacy_window": 1}
    deduped: dict[tuple[int, int], tuple[str, str, int, int, float]] = {}
    for unit in raw:
        key = (unit[2], unit[3])
        if key not in deduped or priority[unit[1]] > priority[deduped[key][1]]:
            deduped[key] = unit

    results: list[dict[str, Any]] = []
    for source_id, unit_kind, start, end, unit_confidence in deduped.values():
        metrics, intents, evidence = _weighted_evidence(start, end, legacy)
        if not any(intents.values()):
            intents = {intent: 0.35 for intent in MOMENT_INTENTS}
        start_strength, start_evidence = _boundary_strength(start, v3)
        end_strength, end_evidence = _boundary_strength(end, v3)
        boundary = math.sqrt(start_strength * end_strength)
        completeness = _clip01(0.48 * {"phrase": 0.97, "phrase_pair": 0.95, "section": 0.91, "legacy_window": 0.45}[unit_kind] + 0.27 * boundary + 0.25 * unit_confidence)
        dominant = max(intents, key=intents.get)
        inherited = max([float(item.get("score") or 0.0) for item in evidence], default=0.35)
        score = _clip01(0.34 * completeness + 0.21 * float(intents.get("musical_identity") or inherited) + 0.18 * float(intents.get("instant_hook") or inherited) + 0.11 * float(intents.get("story_arc") or inherited) + 0.10 * boundary + 0.06 * float(metrics.get("segment_confidence") or unit_confidence))
        section = _section_for(start, end, v3)
        section_label = str((section or {}).get("label") or "Musical phrase")
        reasons = ["Complete musical phrase or section, rather than an arbitrary time window." if unit_kind != "legacy_window" else "Compatibility fallback because no reliable phrase grid was available."]
        if boundary >= 0.78:
            reasons.append("Both edges land on strong musical boundaries.")
        if float(intents.get("musical_identity") or 0) >= 0.7:
            reasons.append("Carries a strong recurring musical identity.")
        if float(intents.get("instant_hook") or 0) >= 0.7:
            reasons.append("Has strong immediate hook evidence.")
        if float(metrics.get("energy_lift") or 0) >= 0.67:
            reasons.append("Contains a clear energy lift or payoff.")
        results.append({
            "id": "", "source_unit_id": source_id, "unit_kind": unit_kind,
            "start_ms": start, "end_ms": end, "duration_ms": end - start,
            "section_id": (section or {}).get("id"), "section_label": section_label,
            "kind": dominant, "score": round(score, 4),
            "musical_completeness": round(completeness, 4), "boundary_confidence": round(boundary, 4),
            "boundary_evidence": {"start": start_evidence, "end": end_evidence},
            "intent_scores": {key: round(float(value), 4) for key, value in intents.items()},
            "metrics": {**{key: round(float(value), 4) for key, value in metrics.items()}, "musical_completeness": round(completeness, 4), "boundary_confidence": round(boundary, 4)},
            "evidence": evidence, "reasons": reasons[:4],
        })
    results.sort(key=lambda item: (-float(item["score"]), -float(item["musical_completeness"]), int(item["start_ms"])))
    return results


def _select_moments(units: list[dict[str, Any]], limit: int = MAX_PRIMARY_MOMENTS) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    seen_intents: set[str] = set()
    seen_sections: set[str] = set()
    while len(selected) < min(limit, len(units)):
        best, best_value = None, -1.0
        for unit in units:
            if unit in selected or any(_overlap_ratio(unit, existing) >= 0.58 for existing in selected):
                continue
            intent, section = str(unit.get("kind") or ""), str(unit.get("section_id") or unit.get("section_label") or "")
            value = float(unit.get("score") or 0) + (0.055 if intent and intent not in seen_intents else 0) + (0.035 if section and section not in seen_sections else 0) + 0.03 * float(unit.get("musical_completeness") or 0)
            if value > best_value:
                best, best_value = unit, value
        if best is None:
            break
        selected.append(best)
        seen_intents.add(str(best.get("kind") or "")); seen_sections.add(str(best.get("section_id") or best.get("section_label") or ""))
    for index, moment in enumerate(selected, 1):
        moment["id"] = f"moment-v4-{index}"
        moment["rank"] = index
        moment["label"] = f"{str(moment.get('kind') or 'musical_identity').replace('_', ' ').title()} · {moment.get('section_label') or 'Musical phrase'}"
    return selected


def _boundary_points(v3: dict[str, Any], start: int, end: int) -> list[int]:
    points = {start, end}
    for name in ("bars", "phrases", "sections"):
        for item in v3.get(name) or []:
            if isinstance(item, dict):
                for key in ("start_ms", "end_ms"):
                    value = item.get(key)
                    if isinstance(value, (int, float)) and start <= int(value) <= end:
                        points.add(int(value))
    for value in v3.get("downbeats_ms") or []:
        if isinstance(value, (int, float)) and start <= int(value) <= end:
            points.add(int(value))
    return sorted(points)


def _social_cuts(v3: dict[str, Any], moments: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
    legacy = v3.get("social_cut_options") or {}
    primary: dict[str, Any] = {}; options: dict[str, list[dict[str, Any]]] = {}
    for target in SOCIAL_DURATIONS_MS:
        key = str(target // 1000); generated: list[dict[str, Any]] = []
        for moment in moments:
            start, end = int(moment["start_ms"]), int(moment["end_ms"])
            if end - start < max(3500, int(target * 0.62)):
                continue
            points = _boundary_points(v3, start, end); best = None
            for i, left in enumerate(points[:-1]):
                for right in points[i + 1:]:
                    duration = right - left
                    if duration < max(3000, int(target * 0.62)) or duration > int(target * 1.38):
                        continue
                    fit = _clip01(1 - abs(duration - target) / target)
                    centered = 1 - min(1.0, abs((left + right) / 2 - (start + end) / 2) / max((end - start) / 2, 1))
                    value = 0.62 * fit + 0.22 * float(moment["score"]) + 0.16 * centered
                    if best is None or value > best[2]: best = (left, right, value)
            if best:
                left, right, value = best
                generated.append({"candidate_id": moment["id"], "source_moment_id": moment["id"], "start_ms": left, "end_ms": right, "duration_ms": right-left, "target_duration_ms": target, "score": round(_clip01(value), 4), "hook_score": moment["score"], "kind": moment["kind"], "label": f"{moment['label']} · {key}s cut", "intent_scores": moment.get("intent_scores") or {}, "musical_boundary_constrained": True})
        generated.sort(key=lambda item: (-float(item["score"]), int(item["start_ms"])))
        chosen: list[dict[str, Any]] = []
        for cut in generated:
            if any(cut["source_moment_id"] == existing.get("source_moment_id") or abs(int(cut["start_ms"]) - int(existing["start_ms"])) < 2200 for existing in chosen): continue
            chosen.append(cut)
            if len(chosen) >= 3: break
        if not chosen:
            for item in (legacy.get(key) or [])[:3]:
                if isinstance(item, dict):
                    copy = dict(item); copy.update({"source_moment_id": None, "target_duration_ms": target, "musical_boundary_constrained": False, "legacy_fallback": True}); chosen.append(copy)
        options[key] = chosen; primary[key] = chosen[0] if chosen else None
    return primary, options


def _intent_rankings(moments: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for intent in MOMENT_INTENTS:
        ranked = sorted(moments, key=lambda item: (-float((item.get("intent_scores") or {}).get(intent) or 0), -float(item.get("score") or 0)))
        result[intent] = [{"candidate_id": item["id"], "start_ms": item["start_ms"], "end_ms": item["end_ms"], "score": round(float((item.get("intent_scores") or {}).get(intent) or 0), 4), "label": item["label"], "musical_completeness": item["musical_completeness"]} for item in ranked[:3]]
    return result


def _rhythm_consensus(v3: dict[str, Any]) -> dict[str, Any]:
    beats = [int(value) for value in v3.get("beats_ms") or [] if isinstance(value, (int, float))]
    downbeats = [int(value) for value in v3.get("downbeats_ms") or [] if isinstance(value, (int, float))]
    inferred = beats[::4] if beats else []
    distances = [min(abs(value - candidate) for candidate in inferred) for value in downbeats] if inferred and downbeats else []
    median = float(np.median(distances)) if distances else None
    source = str(v3.get("downbeat_source") or "none")
    agreement = _clip01(1 - median / 160.0) if median is not None and source == "model" else (0.52 if inferred else 0.0)
    rhythm_conf = float((((v3.get("analysis") or {}).get("confidence") or {}).get("rhythm") or 0.0))
    beat_this_installed = importlib.util.find_spec("beat_this") is not None
    beat_this_enabled = os.getenv("ATLAS_BEAT_THIS_ENABLED", "").lower() in {"1", "true", "yes"}
    return {"primary": {"engine": (v3.get("analysis") or {}).get("engine"), "downbeat_source": source, "beat_confidence": v3.get("beat_confidence")}, "internal_grid_crosscheck": {"available": bool(distances), "median_downbeat_distance_ms": round(median, 2) if median is not None else None, "agreement": round(agreement, 4)}, "shadow_providers": {"beat_this": {"installed": beat_this_installed, "enabled": beat_this_enabled, "status": "available_for_shadow_benchmark" if beat_this_installed and beat_this_enabled else "disabled_or_not_installed"}}, "confidence": round(_clip01(0.62 * rhythm_conf + 0.38 * agreement), 4)}


def _mix_intelligence(path: Path | None, v3: dict[str, Any]) -> dict[str, Any]:
    qc = v3.get("master_qc") or {}
    result: dict[str, Any] = {"technical_ready": bool(qc.get("technical_ready", False)), "loudness": {"integrated_lufs": qc.get("integrated_lufs"), "true_peak_dbtp": qc.get("true_peak_dbtp"), "crest_factor_db": qc.get("crest_factor_db")}, "dynamics": {}, "spectrum": {}, "stereo": {"correlation": qc.get("stereo_correlation")}, "observations": [], "confidence": 0.45, "analysis_note": "Descriptive mix diagnostics, not universal mastering targets."}
    if path is None: return result
    try:
        audio, sr = sf.read(str(path), always_2d=True, dtype="float32")
        if audio.size == 0: return result
        mono = np.mean(audio, axis=1); frame, hop = max(512, int(sr*3)), max(256, int(sr))
        rms_db = []
        for start in range(0, max(1, len(mono)-frame+1), hop):
            window = mono[start:start+frame]
            if len(window) >= frame//2:
                rms = float(np.sqrt(np.mean(np.square(window))))
                if rms > 1e-8: rms_db.append(20*math.log10(rms))
        if rms_db:
            p10, p50, p95 = np.percentile(np.asarray(rms_db), [10,50,95]); result["dynamics"] = {"short_term_rms_p10_dbfs": round(float(p10),2), "short_term_rms_median_dbfs": round(float(p50),2), "short_term_rms_p95_dbfs": round(float(p95),2), "relative_dynamic_spread_db": round(float(p95-p10),2)}
        spectrum = np.mean(np.square(np.abs(librosa.stft(mono, n_fft=4096, hop_length=2048))), axis=1); freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
        bands = {"sub_20_80": (20,80), "bass_80_180": (80,180), "low_mid_180_500": (180,500), "mid_500_2500": (500,2500), "presence_2500_6000": (2500,6000), "air_6000_16000": (6000,min(16000,sr/2))}
        energy = {name: float(np.sum(spectrum[(freqs>=lo)&(freqs<hi)])) for name,(lo,hi) in bands.items()}; total = sum(energy.values()) or 1.0
        result["spectrum"] = {"spectral_centroid_hz": round(float(np.mean(librosa.feature.spectral_centroid(y=mono,sr=sr))),1), "rolloff_95_hz": round(float(np.mean(librosa.feature.spectral_rolloff(y=mono,sr=sr,roll_percent=.95))),1), "band_balance": {name: round(value/total,4) for name,value in energy.items()}}
        if audio.shape[1] >= 2:
            left,right = audio[:,0],audio[:,1]; mid=.5*(left+right); side=.5*(left-right); mid_rms=float(np.sqrt(np.mean(np.square(mid)))); side_rms=float(np.sqrt(np.mean(np.square(side)))); stereo_rms=float(np.sqrt(np.mean((np.square(left)+np.square(right))/2))); mono_delta=20*math.log10(max(mid_rms,1e-9)/max(stereo_rms,1e-9)); result["stereo"].update({"side_to_mid_rms_ratio": round(side_rms/max(mid_rms,1e-9),4), "mono_fold_down_delta_db": round(mono_delta,3)})
            if mono_delta < -3.5: result["observations"].append({"severity":"review","code":"mono_energy_loss","message":"Mono fold-down loses notable RMS energy; audition mono compatibility."})
        balance=result["spectrum"].get("band_balance") or {}
        if float(balance.get("low_mid_180_500") or 0)>0.42: result["observations"].append({"severity":"review","code":"low_mid_dense","message":"The master is unusually concentrated at 180–500 Hz; use this as a review cue, not an automatic defect."})
        if float(balance.get("presence_2500_6000") or 0)>0.38: result["observations"].append({"severity":"review","code":"presence_dense","message":"The 2.5–6 kHz region is comparatively dominant; check harshness at listening level."})
        result["confidence"] = .88
    except Exception as exc:
        result["observations"].append({"severity":"info","code":"deep_mix_analysis_unavailable","message":f"Deep mix diagnostics could not complete: {str(exc)[:160]}"})
    return result


def _capabilities() -> dict[str, Any]:
    def installed(module: str) -> bool:
        try: return importlib.util.find_spec(module) is not None
        except Exception: return False
    truthy=lambda name: os.getenv(name, "").lower() in {"1","true","yes"}
    return {"beat_this":{"purpose":"shadow beat/downbeat tracking","installed":installed("beat_this"),"enabled":truthy("ATLAS_BEAT_THIS_ENABLED"),"tier":"deep"}, "mert":{"purpose":"optional section/catalog music embeddings","installed":installed("transformers"),"enabled":truthy("ATLAS_MERT_ENABLED"),"tier":"on_demand"}, "basic_pitch":{"purpose":"optional stem note/melody transcription","installed":installed("basic_pitch"),"enabled":truthy("ATLAS_BASIC_PITCH_ENABLED"),"tier":"on_demand"}, "singing_aligner":{"purpose":"known-lyrics-to-vocal forced alignment","installed":False,"enabled":truthy("ATLAS_SINGING_ALIGNER_ENABLED"),"tier":"deep","status":"adapter_required"}}


def _timeline(v3: dict[str, Any], moments: list[dict[str, Any]]) -> dict[str, Any]:
    events=[]
    for section in v3.get("sections") or []:
        if isinstance(section,dict): events.append({"id":str(section.get("id") or f"section-{section.get('start_ms')}"),"kind":"section","start_ms":int(section.get("start_ms") or 0),"end_ms":int(section.get("end_ms") or 0),"confidence":round(_clip01(float(section.get("confidence") or .45)),4),"analyzer":str((v3.get("analysis") or {}).get("engine") or "track_intelligence"),"analyzer_version":str(v3.get("version") or 3),"label":str(section.get("label") or "Section"),"evidence":{"section_type":section.get("type")}})
    for phrase in v3.get("phrases") or []:
        if isinstance(phrase,dict): events.append({"id":str(phrase.get("id") or f"phrase-{phrase.get('start_ms')}"),"kind":"phrase","start_ms":int(phrase.get("start_ms") or 0),"end_ms":int(phrase.get("end_ms") or 0),"confidence":round(_clip01(float(phrase.get("confidence") or .45)),4),"analyzer":"track_intelligence","analyzer_version":str(v3.get("version") or 3),"label":"Musical phrase","evidence":{"provenance":phrase.get("provenance"),"section_id":phrase.get("section_id"),"bar_start":phrase.get("bar_start"),"bar_end":phrase.get("bar_end")}})
    for moment in moments:
        events.append({"id":moment["id"],"kind":"musical_moment","start_ms":moment["start_ms"],"end_ms":moment["end_ms"],"confidence":moment["score"],"analyzer":"track_intelligence_v4","analyzer_version":ANALYSIS_CONFIG,"label":moment["label"],"evidence":{"intent":moment.get("kind"),"musical_completeness":moment.get("musical_completeness"),"boundary_confidence":moment.get("boundary_confidence"),"reasons":moment.get("reasons")}})
    events.sort(key=lambda item:(int(item["start_ms"]),int(item["end_ms"]),str(item["kind"])))
    return {"version":TIMELINE_VERSION,"duration_ms":v3.get("duration_ms"),"events":events,"rhythm_grid":{"bpm":v3.get("bpm"),"beats_ms":v3.get("beats_ms") or [],"downbeats_ms":v3.get("downbeats_ms") or [],"bars":v3.get("bars") or [],"downbeat_source":v3.get("downbeat_source")},"fusion_contract":{"external_evidence":["lyrics_intelligence","stem_intelligence","audio_scene"],"rule":"Downstream systems may enrich this timeline with aligned evidence while preserving analyzer provenance."}}


def upgrade_music_intelligence(v3: dict[str, Any], path: Path | None = None) -> dict[str, Any]:
    units=_musical_units(v3); moments=_select_moments(units); social_cuts,social_options=_social_cuts(v3,moments); rankings=_intent_rankings(moments); rhythm=_rhythm_consensus(v3); capabilities=_capabilities()
    result=dict(v3); result.update({"version":ANALYSIS_VERSION,"schema":"atlas.track_music_intelligence.v4","analysis_config":ANALYSIS_CONFIG,"hook_candidates_v3":v3.get("hook_candidates") or [],"hook_candidates":moments,"musical_moments":moments,"moments":rankings,"social_cuts":social_cuts,"social_cut_options":social_options,"timeline":_timeline(v3,moments),"rhythm_consensus":rhythm,"mix_intelligence":_mix_intelligence(path,v3),"analysis_tiers":{"fast":{"status":"completed","includes":["decode_identity","master_qc","waveform_ready_metadata"]},"deep":{"status":"completed","includes":["rhythm","structure","semantic_recurrence","musical_moments","social_cuts","mix_intelligence"]},"on_demand":{"status":"available_when_provider_enabled","includes":["catalog_embeddings","stem_note_transcription","advanced_forced_alignment"]}},"provider_capabilities":capabilities})
    analysis=dict(result.get("analysis") or {}); analysis.update({"config":ANALYSIS_CONFIG,"v3_baseline_config":((v3.get("analysis") or {}).get("config")),"moment_selection":{"strategy":"musical_units_then_derived_cuts","visible_limit":MAX_PRIMARY_MOMENTS,"candidate_unit_count":len(units),"selected_count":len(moments),"diversity_constrained":True,"boundary_constrained":True},"rhythm_consensus_confidence":rhythm["confidence"],"provider_capabilities":capabilities}); result["analysis"]=analysis
    source_audio=dict(result.get("source_audio") or {}); source_audio["analysis_config"]=ANALYSIS_CONFIG; result["source_audio"]=source_audio
    return result


def analyze_music(path: Path, source_audio: dict[str, Any] | None = None) -> dict[str, Any]:
    """Keep V3 as the deterministic baseline, then upgrade its evidence into the V4 product contract."""
    return upgrade_music_intelligence(analyze_music_v3(path, source_audio), path)
