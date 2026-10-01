from __future__ import annotations

import math
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import imageio_ffmpeg
import librosa
import numpy as np
import pyloudnorm as pyln
import soundfile as sf

MASTERING_SCHEMA = "ensemblis.mastering_inspector.v2"
MASTERING_LEGACY_SCHEMA = "ensemblis.mastering_inspector.v1"
SPOTIFY_PROFILE_VERSION = "spotify-artist-guidance-2026-09"
BAND_RANGES_HZ = {
    "sub_20_80": (20.0, 80.0),
    "bass_80_180": (80.0, 180.0),
    "low_mid_180_500": (180.0, 500.0),
    "mid_500_2500": (500.0, 2500.0),
    "presence_2500_6000": (2500.0, 6000.0),
    "air_6000_16000": (6000.0, 16000.0),
}
PERCEPTUAL_BANDS_HZ = {
    "sub_20_40": (20.0, 40.0),
    "sub_40_80": (40.0, 80.0),
    "bass_80_160": (80.0, 160.0),
    "bass_160_315": (160.0, 315.0),
    "low_mid_315_630": (315.0, 630.0),
    "mid_630_1250": (630.0, 1250.0),
    "upper_mid_1250_2500": (1250.0, 2500.0),
    "presence_2500_4000": (2500.0, 4000.0),
    "presence_4000_6000": (4000.0, 6000.0),
    "air_6000_10000": (6000.0, 10000.0),
    "air_10000_16000": (10000.0, 16000.0),
    "ultra_16000_20000": (16000.0, 20000.0),
}


def _db(value: float) -> float:
    return 20.0 * math.log10(max(float(value), 1e-12))


def _finite(value: Any) -> float | None:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if math.isfinite(numeric) else None


def _round(value: float | None, digits: int = 3) -> float | None:
    return round(value, digits) if value is not None and math.isfinite(value) else None


def _issue(*, severity: str, category: str, code: str, message: str,
           start_ms: int | None = None, end_ms: int | None = None,
           evidence: dict[str, Any] | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"severity": severity, "category": category, "code": code, "message": message}
    if start_ms is not None:
        result["start_ms"] = max(0, int(start_ms))
    if end_ms is not None:
        result["end_ms"] = max(int(start_ms or 0) + 1, int(end_ms))
    if evidence:
        result["evidence"] = evidence
    return result


def _ffmpeg_exe() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def _run_ffmpeg(args: list[str], timeout: int = 180) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [_ffmpeg_exe(), "-hide_banner", "-nostdin", *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
        check=False,
    )


def _parse_ebur128_summary(stderr: str) -> dict[str, Any]:
    summary_start = stderr.rfind("Summary:")
    summary = stderr[summary_start:] if summary_start >= 0 else stderr

    def match(pattern: str) -> float | None:
        found = re.search(pattern, summary, re.MULTILINE)
        return _finite(found.group(1)) if found else None

    return {
        "integrated_lufs": _round(match(r"^\s*I:\s*(-?\d+(?:\.\d+)?)\s*LUFS"), 2),
        "loudness_range_lu": _round(match(r"^\s*LRA:\s*(-?\d+(?:\.\d+)?)\s*LU"), 2),
        "lra_low_lufs": _round(match(r"^\s*LRA low:\s*(-?\d+(?:\.\d+)?)\s*LUFS"), 2),
        "lra_high_lufs": _round(match(r"^\s*LRA high:\s*(-?\d+(?:\.\d+)?)\s*LUFS"), 2),
        "true_peak_dbtp": _round(match(r"^\s*Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS"), 3),
        "relative_threshold_lufs": _round(match(r"^\s*Threshold:\s*(-?\d+(?:\.\d+)?)\s*LUFS"), 2),
    }


_FRAME_RE = re.compile(
    r"t:\s*(?P<t>\d+(?:\.\d+)?)"
    r".*?\bM:\s*(?P<m>-?\d+(?:\.\d+)?)"
    r"\s+S:\s*(?P<s>-?\d+(?:\.\d+)?)"
    r"\s+I:\s*(?P<i>-?\d+(?:\.\d+)?)"
    r".*?\bLRA:\s*(?P<lra>-?\d+(?:\.\d+)?)"
    r".*?\b(?:FTPK|TPK):\s*(?P<peak>-?\d+(?:\.\d+)?)"
)


def _parse_ebur128_timeline(stderr: str) -> list[dict[str, Any]]:
    raw: list[dict[str, Any]] = []
    for line in stderr.splitlines():
        found = _FRAME_RE.search(line)
        if not found:
            continue
        t = _finite(found.group("t"))
        if t is None:
            continue
        raw.append({
            "ms": max(0, int(round(t * 1000.0))),
            "momentary_lufs": _round(_finite(found.group("m")), 2),
            "short_term_lufs": _round(_finite(found.group("s")), 2),
            "integrated_lufs": _round(_finite(found.group("i")), 2),
            "lra_lu": _round(_finite(found.group("lra")), 2),
            "frame_true_peak_dbtp": _round(_finite(found.group("peak")), 3),
        })
    if len(raw) <= 360:
        return raw
    stride = max(1, int(math.ceil(len(raw) / 360)))
    sampled = raw[::stride]
    if raw and sampled[-1]["ms"] != raw[-1]["ms"]:
        sampled.append(raw[-1])
    return sampled


def _measure_ebur128(path: Path) -> dict[str, Any]:
    process = _run_ffmpeg([
        "-loglevel", "verbose", "-i", str(path),
        "-filter_complex", "ebur128=peak=true:framelog=verbose",
        "-f", "null", "-",
    ])
    if process.returncode != 0:
        return {"status": "unavailable", "engine": "ffmpeg-ebur128", "reason": process.stderr[-600:], "timeline": []}
    return {
        "status": "completed",
        "engine": "ffmpeg-ebur128",
        "standard": "ITU-R BS.1770 / EBU R128",
        **_parse_ebur128_summary(process.stderr),
        "timeline": _parse_ebur128_timeline(process.stderr),
    }


def _pyloudnorm_crosscheck(audio: np.ndarray, sample_rate: int) -> dict[str, Any]:
    try:
        meter = pyln.Meter(sample_rate)
        integrated = float(meter.integrated_loudness(audio))
        lra_fn = getattr(meter, "loudness_range", None)
        lra = float(lra_fn(audio)) if callable(lra_fn) else None
        return {"status": "completed", "engine": "pyloudnorm", "integrated_lufs": _round(integrated, 2), "loudness_range_lu": _round(lra, 2)}
    except Exception as exc:
        return {"status": "unavailable", "engine": "pyloudnorm", "reason": str(exc)[:240]}


def _format_info(path: Path, sample_rate: int, channels: int) -> dict[str, Any]:
    try:
        info = sf.info(str(path))
        subtype = str(info.subtype or "")
        bit_depth = None
        for key, bits in {"PCM_16": 16, "PCM_24": 24, "PCM_32": 32, "FLOAT": 32, "DOUBLE": 64}.items():
            if key in subtype:
                bit_depth = bits
                break
        return {
            "container": info.format,
            "subtype": subtype or None,
            "bit_depth": bit_depth,
            "sample_rate_hz": int(info.samplerate),
            "channels": int(info.channels),
            "frames": int(info.frames),
            "duration_seconds": _round(float(info.duration), 3),
            "endian": info.endian,
        }
    except Exception:
        return {"container": None, "subtype": None, "bit_depth": None, "sample_rate_hz": int(sample_rate), "channels": int(channels)}


def _sample_qc(audio: np.ndarray, sample_rate: int) -> dict[str, Any]:
    absolute = np.abs(audio)
    peak_index_flat = int(np.argmax(absolute))
    peak_frame = peak_index_flat // max(1, audio.shape[1])
    peak_channel = peak_index_flat % max(1, audio.shape[1])
    peak = float(absolute.reshape(-1)[peak_index_flat])
    sample_peak_dbfs = _db(peak)
    rms = float(np.sqrt(np.mean(np.square(audio))))
    rms_dbfs = _db(rms)
    clipping_mask = absolute >= 1.0
    near_full_scale_mask = absolute >= 0.999
    clipping_samples = int(np.sum(clipping_mask))
    near_full_scale_samples = int(np.sum(near_full_scale_mask))
    dc_offset = float(np.max(np.abs(np.mean(audio, axis=0))))

    active = np.flatnonzero(np.max(absolute, axis=1) > 10 ** (-60 / 20))
    if active.size:
        leading_silence_ms = int(round(active[0] / sample_rate * 1000))
        trailing_silence_ms = int(round((len(audio) - 1 - active[-1]) / sample_rate * 1000))
    else:
        duration_ms = int(round(len(audio) / sample_rate * 1000))
        leading_silence_ms = duration_ms
        trailing_silence_ms = duration_ms

    max_run = 0
    if near_full_scale_samples:
        frame_hot = np.any(near_full_scale_mask, axis=1)
        padded = np.concatenate(([False], frame_hot, [False]))
        transitions = np.diff(padded.astype(np.int8))
        starts = np.flatnonzero(transitions == 1)
        ends = np.flatnonzero(transitions == -1)
        if starts.size:
            max_run = int(np.max(ends - starts))

    return {
        "sample_peak_dbfs": _round(sample_peak_dbfs, 3),
        "sample_peak_channel": int(peak_channel + 1),
        "sample_peak_ms": int(round(peak_frame / sample_rate * 1000)),
        "rms_dbfs": _round(rms_dbfs, 3),
        "crest_factor_db": _round(sample_peak_dbfs - rms_dbfs, 3),
        "clipping_samples": clipping_samples,
        "near_full_scale_samples": near_full_scale_samples,
        "max_near_full_scale_run_ms": _round(max_run / sample_rate * 1000.0, 3),
        "dc_offset": _round(dc_offset, 6),
        "leading_silence_ms": leading_silence_ms,
        "trailing_silence_ms": trailing_silence_ms,
    }


def _true_peak_fallback(audio: np.ndarray, sample_rate: int) -> tuple[float, int]:
    best_peak = 0.0
    best_channel = 0
    for channel in range(audio.shape[1]):
        try:
            oversampled = librosa.resample(audio[:, channel], orig_sr=sample_rate, target_sr=sample_rate * 4, res_type="soxr_hq")
            peak = float(np.max(np.abs(oversampled)))
        except Exception:
            peak = float(np.max(np.abs(audio[:, channel])))
        if peak > best_peak:
            best_peak = peak
            best_channel = channel
    return _db(best_peak), best_channel + 1


def _windowed_stereo(audio: np.ndarray, sample_rate: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if audio.shape[1] < 2:
        return {"channels": int(audio.shape[1]), "correlation": None, "side_to_mid_rms_ratio": None, "mono_fold_down_delta_db": None, "band_side_share": {}}, []

    left = audio[:, 0].astype(np.float64)
    right = audio[:, 1].astype(np.float64)
    correlation = float(np.corrcoef(left, right)[0, 1]) if np.std(left) > 1e-9 and np.std(right) > 1e-9 else None
    mid = 0.5 * (left + right)
    side = 0.5 * (left - right)
    mid_rms = float(np.sqrt(np.mean(np.square(mid))))
    side_rms = float(np.sqrt(np.mean(np.square(side))))
    stereo_rms = float(np.sqrt(np.mean((np.square(left) + np.square(right)) / 2.0)))
    mono_delta = 20.0 * math.log10(max(mid_rms, 1e-12) / max(stereo_rms, 1e-12))

    n_fft = 4096
    hop = 2048
    left_stft = librosa.stft(left.astype(np.float32), n_fft=n_fft, hop_length=hop)
    right_stft = librosa.stft(right.astype(np.float32), n_fft=n_fft, hop_length=hop)
    mid_power = np.square(np.abs((left_stft + right_stft) * 0.5))
    side_power = np.square(np.abs((left_stft - right_stft) * 0.5))
    freqs = librosa.fft_frequencies(sr=sample_rate, n_fft=n_fft)
    band_side_share: dict[str, float] = {}
    for name, (low, high) in BAND_RANGES_HZ.items():
        high = min(high, sample_rate / 2.0)
        mask = (freqs >= low) & (freqs < high)
        mid_energy = float(np.sum(mid_power[mask]))
        side_energy = float(np.sum(side_power[mask]))
        total = mid_energy + side_energy
        band_side_share[name] = round(side_energy / total, 4) if total > 0 else 0.0

    windows: list[dict[str, Any]] = []
    frame = max(sample_rate * 4, 1)
    hop_samples = max(sample_rate * 2, 1)
    for start in range(0, max(1, len(left) - frame + 1), hop_samples):
        end = min(len(left), start + frame)
        l = left[start:end]
        r = right[start:end]
        if len(l) < sample_rate:
            continue
        m = 0.5 * (l + r)
        m_rms = float(np.sqrt(np.mean(np.square(m))))
        s_rms = float(np.sqrt(np.mean((np.square(l) + np.square(r)) / 2.0)))
        delta = 20.0 * math.log10(max(m_rms, 1e-12) / max(s_rms, 1e-12))
        corr = float(np.corrcoef(l, r)[0, 1]) if np.std(l) > 1e-9 and np.std(r) > 1e-9 else None
        windows.append({
            "start_ms": int(round(start / sample_rate * 1000)),
            "end_ms": int(round(end / sample_rate * 1000)),
            "mono_fold_down_delta_db": round(delta, 3),
            "correlation": round(corr, 4) if corr is not None else None,
        })

    return {
        "channels": int(audio.shape[1]),
        "correlation": round(correlation, 4) if correlation is not None else None,
        "side_to_mid_rms_ratio": round(side_rms / max(mid_rms, 1e-12), 4),
        "mono_fold_down_delta_db": round(mono_delta, 3),
        "band_side_share": band_side_share,
    }, windows


def _spectral_profile(audio: np.ndarray, sample_rate: int) -> dict[str, Any]:
    mono = np.mean(audio, axis=1).astype(np.float32)
    n_fft = 4096
    hop = 2048
    stft = librosa.stft(mono, n_fft=n_fft, hop_length=hop)
    power = np.square(np.abs(stft))
    spectrum = np.mean(power, axis=1)
    freqs = librosa.fft_frequencies(sr=sample_rate, n_fft=n_fft)

    def band_energy(ranges: dict[str, tuple[float, float]]) -> dict[str, float]:
        result: dict[str, float] = {}
        for name, (low, high) in ranges.items():
            upper = min(high, sample_rate / 2.0)
            mask = (freqs >= low) & (freqs < upper)
            result[name] = float(np.sum(spectrum[mask])) if np.any(mask) else 0.0
        return result

    energy = band_energy(BAND_RANGES_HZ)
    total = sum(energy.values()) or 1.0
    perceptual_energy = band_energy(PERCEPTUAL_BANDS_HZ)
    perceptual_total = sum(perceptual_energy.values()) or 1.0
    return {
        "spectral_centroid_hz": round(float(np.mean(librosa.feature.spectral_centroid(y=mono, sr=sample_rate))), 1),
        "rolloff_95_hz": round(float(np.mean(librosa.feature.spectral_rolloff(y=mono, sr=sample_rate, roll_percent=0.95))), 1),
        "band_balance": {name: round(value / total, 5) for name, value in energy.items()},
        "band_relative_db": {name: round(10.0 * math.log10(max(value / total, 1e-12)), 3) for name, value in energy.items()},
        "perceptual_envelope_db": {
            name: round(10.0 * math.log10(max(value / perceptual_total, 1e-12)), 3)
            for name, value in perceptual_energy.items()
        },
        "perceptual_band_count": len(PERCEPTUAL_BANDS_HZ),
    }


def _transient_profile(audio: np.ndarray, sample_rate: int) -> dict[str, Any]:
    mono = np.mean(audio, axis=1).astype(np.float32)
    if mono.size < max(1024, sample_rate // 4):
        return {
            "status": "insufficient_evidence",
            "onset_density_per_second": None,
            "onset_strength_median": None,
            "onset_strength_p95": None,
            "transient_crest_median_db": None,
            "transient_crest_p90_db": None,
        }

    hop_length = 512
    onset = librosa.onset.onset_strength(
        y=mono,
        sr=sample_rate,
        hop_length=hop_length,
    )
    onset = np.asarray(onset, dtype=np.float64)
    finite_onset = onset[np.isfinite(onset)]
    if finite_onset.size:
        onset_median = float(np.median(finite_onset))
        onset_p95 = float(np.percentile(finite_onset, 95))
        onset_mad = float(np.median(np.abs(finite_onset - onset_median)))
        threshold = onset_median + max(0.25, 2.5 * onset_mad)
        if finite_onset.size >= 3:
            peaks = (
                (finite_onset[1:-1] > finite_onset[:-2])
                & (finite_onset[1:-1] >= finite_onset[2:])
                & (finite_onset[1:-1] >= threshold)
            )
            onset_count = int(np.sum(peaks))
        else:
            onset_count = 0
    else:
        onset_median = 0.0
        onset_p95 = 0.0
        onset_count = 0

    duration_seconds = mono.size / float(max(sample_rate, 1))
    frame = max(256, int(round(sample_rate * 0.05)))
    hop = max(128, frame // 2)
    crest_values: list[float] = []
    for start in range(0, max(1, mono.size - frame + 1), hop):
        window = mono[start:start + frame]
        if window.size < frame // 2:
            continue
        rms = float(np.sqrt(np.mean(np.square(window))))
        peak = float(np.max(np.abs(window)))
        if rms <= 1e-9 or peak <= 1e-9:
            continue
        crest_values.append(_db(peak) - _db(rms))

    return {
        "status": "completed",
        "onset_density_per_second": round(onset_count / max(duration_seconds, 1e-9), 3),
        "onset_strength_median": round(onset_median, 4),
        "onset_strength_p95": round(onset_p95, 4),
        "transient_crest_median_db": round(float(np.median(crest_values)), 3) if crest_values else None,
        "transient_crest_p90_db": round(float(np.percentile(crest_values, 90)), 3) if crest_values else None,
        "analysis_note": "Transient evidence combines spectral-flux onset activity with short-window crest distribution. It is descriptive and is used for before/after preservation checks, not as a genre target.",
    }


def _section_mastering_signatures(
    audio: np.ndarray,
    sample_rate: int,
    sections: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    signatures: list[dict[str, Any]] = []
    duration_ms = int(round(len(audio) / max(sample_rate, 1) * 1000.0))
    for index, section in enumerate(sections[:16]):
        if not isinstance(section, dict):
            continue
        try:
            start_ms = max(0, int(section.get("start_ms") or 0))
            end_ms = min(duration_ms, int(section.get("end_ms") or 0))
        except (TypeError, ValueError):
            continue
        if end_ms - start_ms < 2000:
            continue
        start = int(round(start_ms * sample_rate / 1000.0))
        end = int(round(end_ms * sample_rate / 1000.0))
        window = audio[start:end]
        if window.size == 0:
            continue
        spectral = _spectral_profile(window, sample_rate)
        transients = _transient_profile(window, sample_rate)
        qc = _sample_qc(window, sample_rate)
        signatures.append({
            "id": str(section.get("id") or f"section-{index + 1}"),
            "label": str(section.get("label") or section.get("type") or f"Section {index + 1}"),
            "start_ms": start_ms,
            "end_ms": end_ms,
            "duration_ms": end_ms - start_ms,
            "rms_dbfs": qc.get("rms_dbfs"),
            "crest_factor_db": qc.get("crest_factor_db"),
            "band_relative_db": spectral.get("band_relative_db"),
            "perceptual_envelope_db": spectral.get("perceptual_envelope_db"),
            "onset_density_per_second": transients.get("onset_density_per_second"),
            "transient_crest_p90_db": transients.get("transient_crest_p90_db"),
        })
    return signatures


def _dynamics(audio: np.ndarray, sample_rate: int, loudness: dict[str, Any], sample_qc: dict[str, Any]) -> dict[str, Any]:
    mono = np.mean(audio, axis=1)
    frame = max(512, sample_rate * 3)
    hop = max(256, sample_rate)
    rms_db: list[float] = []
    for start in range(0, max(1, len(mono) - frame + 1), hop):
        window = mono[start:start + frame]
        if len(window) < frame // 2:
            continue
        rms = float(np.sqrt(np.mean(np.square(window))))
        if rms > 1e-9:
            rms_db.append(_db(rms))
    distribution: dict[str, float | None] = {
        "short_term_rms_p10_dbfs": None,
        "short_term_rms_median_dbfs": None,
        "short_term_rms_p95_dbfs": None,
        "relative_dynamic_spread_db": None,
    }
    if rms_db:
        p10, p50, p95 = np.percentile(np.asarray(rms_db, dtype=np.float64), [10, 50, 95])
        distribution = {
            "short_term_rms_p10_dbfs": round(float(p10), 2),
            "short_term_rms_median_dbfs": round(float(p50), 2),
            "short_term_rms_p95_dbfs": round(float(p95), 2),
            "relative_dynamic_spread_db": round(float(p95 - p10), 2),
        }
    integrated = _finite(loudness.get("integrated_lufs"))
    true_peak = _finite(loudness.get("true_peak_dbtp"))
    if true_peak is None:
        true_peak = _finite(sample_qc.get("sample_peak_dbfs"))
    plr = true_peak - integrated if true_peak is not None and integrated is not None else None
    psr_values: list[float] = []
    for point in loudness.get("timeline") or []:
        short_term = _finite(point.get("short_term_lufs"))
        frame_peak = _finite(point.get("frame_true_peak_dbtp"))
        if short_term is None or frame_peak is None or short_term < -60:
            continue
        psr_values.append(frame_peak - short_term)
    return {
        **distribution,
        "loudness_range_lu": loudness.get("loudness_range_lu"),
        "peak_to_loudness_ratio_lu": _round(plr, 2),
        "psr_median_lu": _round(float(np.median(psr_values)), 2) if psr_values else None,
        "psr_p10_lu": _round(float(np.percentile(psr_values, 10)), 2) if psr_values else None,
        "crest_factor_db": sample_qc.get("crest_factor_db"),
    }



def _temporal_stability(audio: np.ndarray, sample_rate: int, sections: list[dict[str, Any]]) -> dict[str, Any]:
    """Find unusually persistent mix/render changes without pretending to identify AI artifacts."""
    duration_seconds = len(audio) / max(sample_rate, 1)
    if duration_seconds < 28:
        return {
            "status": "insufficient_evidence",
            "classification": "unknown",
            "confidence": 0.0,
            "timeline": [],
            "findings": [],
            "analysis_note": "Temporal render stability needs enough duration to compare several musical windows.",
        }

    frame = max(sample_rate * 8, 1)
    hop = max(sample_rate * 4, 1)
    n_fft = 2048
    timeline: list[dict[str, Any]] = []
    mono = np.mean(audio, axis=1).astype(np.float32)
    freqs = librosa.fft_frequencies(sr=sample_rate, n_fft=n_fft)

    for start in range(0, max(1, len(audio) - frame + 1), hop):
        end = min(len(audio), start + frame)
        if end - start < sample_rate * 4:
            continue
        window = audio[start:end]
        mono_window = mono[start:end]
        stft = librosa.stft(mono_window, n_fft=n_fft, hop_length=n_fft // 2)
        power = np.square(np.abs(stft))
        spectrum = np.mean(power, axis=1)
        band_energy: dict[str, float] = {}
        for name, (low, high) in BAND_RANGES_HZ.items():
            upper = min(high, sample_rate / 2.0)
            mask = (freqs >= low) & (freqs < upper)
            band_energy[name] = float(np.sum(spectrum[mask]))
        total = sum(band_energy.values()) or 1.0
        band_db = {
            name: 10.0 * math.log10(max(value / total, 1e-12))
            for name, value in band_energy.items()
        }

        rms = float(np.sqrt(np.mean(np.square(mono_window))))
        peak = float(np.max(np.abs(mono_window)))
        crest = _db(peak) - _db(rms)
        centroid = float(np.mean(librosa.feature.spectral_centroid(y=mono_window, sr=sample_rate)))
        flatness = float(np.mean(librosa.feature.spectral_flatness(y=mono_window)))
        correlation = None
        mono_delta = None
        if window.shape[1] >= 2:
            left = window[:, 0].astype(np.float64)
            right = window[:, 1].astype(np.float64)
            if np.std(left) > 1e-9 and np.std(right) > 1e-9:
                correlation = float(np.corrcoef(left, right)[0, 1])
            mid = 0.5 * (left + right)
            stereo_rms = float(np.sqrt(np.mean((np.square(left) + np.square(right)) / 2.0)))
            mid_rms = float(np.sqrt(np.mean(np.square(mid))))
            mono_delta = 20.0 * math.log10(max(mid_rms, 1e-12) / max(stereo_rms, 1e-12))

        center_ms = int(round(((start + end) * 0.5) / sample_rate * 1000))
        timeline.append({
            "start_ms": int(round(start / sample_rate * 1000)),
            "end_ms": int(round(end / sample_rate * 1000)),
            "ms": center_ms,
            "crest_factor_db": round(crest, 3),
            "spectral_centroid_hz": round(centroid, 1),
            "spectral_flatness": round(flatness, 6),
            "low_mid_db": round(band_db.get("low_mid_180_500", -120.0), 3),
            "presence_db": round(band_db.get("presence_2500_6000", -120.0), 3),
            "air_db": round(band_db.get("air_6000_16000", -120.0), 3),
            "stereo_correlation": round(correlation, 4) if correlation is not None else None,
            "mono_fold_down_delta_db": round(mono_delta, 3) if mono_delta is not None else None,
        })

    if len(timeline) < 6:
        return {
            "status": "insufficient_evidence",
            "classification": "unknown",
            "confidence": 0.0,
            "timeline": timeline,
            "findings": [],
            "analysis_note": "Temporal render stability needs at least six analysis windows.",
        }

    def series(key: str) -> np.ndarray:
        values = [float(item[key]) for item in timeline if isinstance(item.get(key), (int, float))]
        return np.asarray(values, dtype=np.float64)

    def persistent_change(key: str, threshold: float) -> tuple[float, int] | None:
        values = series(key)
        if values.size < 6:
            return None
        span = max(2, values.size // 3)
        early = float(np.median(values[:span]))
        late = float(np.median(values[-span:]))
        delta = late - early
        if abs(delta) < threshold:
            return None
        # Require the latter part to move consistently, not one isolated window.
        late_values = values[-span:]
        threshold_delta = threshold * 0.55
        direction_ratio = float(np.mean(late_values >= early + threshold_delta)) if delta > 0 else float(np.mean(late_values <= early - threshold_delta))
        if direction_ratio < 0.66:
            return None

        # Locate the onset of the persistent change instead of using the beginning
        # of the final comparison bucket. Section-boundary discounting must be
        # evaluated where the tonal/transient shift actually starts.
        for index in range(span, len(values)):
            probe = values[index:min(len(values), index + 3)]
            if probe.size == 0:
                continue
            crossed = probe >= early + threshold_delta if delta > 0 else probe <= early - threshold_delta
            if float(np.mean(crossed)) >= 0.66:
                first_crossing = np.flatnonzero(crossed)
                if first_crossing.size:
                    return delta, index + int(first_crossing[0])
        return delta, max(1, len(timeline) - span)

    findings: list[dict[str, Any]] = []

    air_change = persistent_change("air_db", 2.4)
    centroid_change = persistent_change("spectral_centroid_hz", 700.0)
    crest_change = persistent_change("crest_factor_db", 1.8)
    low_mid_change = persistent_change("low_mid_db", 2.4)

    if air_change and air_change[0] < 0 and (not centroid_change or centroid_change[0] < 0):
        delta, index = air_change
        point = timeline[index]
        boundary = _section_boundary_distance(int(point["ms"]), sections)
        if boundary is None or boundary > 7000:
            findings.append({
                "severity": "review",
                "code": "high_frequency_detail_drop",
                "message": "High-frequency detail falls persistently later in the track without a nearby section boundary. Listen for dulling, smearing or render degradation.",
                "start_ms": point["start_ms"],
                "end_ms": timeline[-1]["end_ms"],
                "evidence": {
                    "air_delta_db": round(delta, 2),
                    "centroid_delta_hz": round(centroid_change[0], 1) if centroid_change else None,
                    "nearest_section_boundary_ms": boundary,
                },
            })

    if low_mid_change and low_mid_change[0] > 0:
        delta, index = low_mid_change
        point = timeline[index]
        boundary = _section_boundary_distance(int(point["ms"]), sections)
        if boundary is None or boundary > 7000:
            findings.append({
                "severity": "review",
                "code": "low_mid_buildup",
                "message": "Low-mid energy builds persistently later in the track without a nearby section boundary. Listen for mud or bass accumulation.",
                "start_ms": point["start_ms"],
                "end_ms": timeline[-1]["end_ms"],
                "evidence": {
                    "low_mid_delta_db": round(delta, 2),
                    "nearest_section_boundary_ms": boundary,
                },
            })

    if crest_change and crest_change[0] < 0:
        delta, index = crest_change
        point = timeline[index]
        boundary = _section_boundary_distance(int(point["ms"]), sections)
        if boundary is None or boundary > 7000:
            findings.append({
                "severity": "review",
                "code": "transient_contrast_drop",
                "message": "Transient contrast falls persistently later in the track. Listen for increasing saturation, compression or softened attacks.",
                "start_ms": point["start_ms"],
                "end_ms": timeline[-1]["end_ms"],
                "evidence": {
                    "crest_delta_db": round(delta, 2),
                    "nearest_section_boundary_ms": boundary,
                },
            })

    correlations = [
        (index, float(item["stereo_correlation"]))
        for index, item in enumerate(timeline)
        if isinstance(item.get("stereo_correlation"), (int, float))
    ]
    if correlations:
        median_corr = float(np.median([value for _, value in correlations]))
        worst_index, worst_corr = min(correlations, key=lambda item: item[1])
        if worst_corr < -0.15 and worst_corr < median_corr - 0.3:
            point = timeline[worst_index]
            boundary = _section_boundary_distance(int(point["ms"]), sections)
            if boundary is None or boundary > 3500:
                findings.append({
                    "severity": "review",
                    "code": "stereo_instability",
                    "message": "Stereo correlation changes unusually in this window. Listen for phasey or unstable spatial texture.",
                    "start_ms": point["start_ms"],
                    "end_ms": point["end_ms"],
                    "evidence": {
                        "correlation": round(worst_corr, 3),
                        "median_correlation": round(median_corr, 3),
                        "nearest_section_boundary_ms": boundary,
                    },
                })

    # Avoid overwhelming the artist. Strongest persistent evidence comes first.
    findings = findings[:4]
    return {
        "status": "completed",
        "classification": "review" if findings else "stable",
        "confidence": round(min(0.96, 0.65 + min(len(timeline), 36) / 120.0), 3),
        "timeline": timeline,
        "findings": findings,
        "analysis_note": "Temporal stability compares robust windowed spectral, transient and stereo evidence while discounting changes near known musical section boundaries. It surfaces audition cues, not AI-authorship claims.",
    }


def _section_boundary_distance(ms: int, sections: list[dict[str, Any]]) -> int | None:
    points: list[int] = []
    for section in sections:
        if not isinstance(section, dict):
            continue
        for key in ("start_ms", "end_ms"):
            value = section.get(key)
            if isinstance(value, (int, float)):
                points.append(int(value))
    return min((abs(ms - point) for point in points), default=None)


def _normalize_bpm(value: float, anchor: float) -> float:
    if value <= 0 or anchor <= 0:
        return value
    normalized = value
    while normalized < anchor * 0.67:
        normalized *= 2.0
    while normalized > anchor * 1.5:
        normalized /= 2.0
    return normalized


def analyze_beat_stability(beats_ms: list[int], *, global_bpm: float | None,
                           sections: list[dict[str, Any]], rhythm_confidence: float | None) -> dict[str, Any]:
    beats = np.asarray(sorted({int(value) for value in beats_ms if int(value) >= 0}), dtype=np.float64)
    if beats.size < 16:
        return {"status": "insufficient_evidence", "classification": "unknown", "beat_count": int(beats.size), "confidence": 0.0, "issues": [], "timeline": [], "analysis_note": "Beat stability needs at least 16 reliable beat timestamps."}
    intervals = np.diff(beats) / 1000.0
    valid = intervals[(intervals > 0.15) & (intervals < 2.5)]
    if valid.size < 12:
        return {"status": "insufficient_evidence", "classification": "unknown", "beat_count": int(beats.size), "confidence": 0.0, "issues": [], "timeline": [], "analysis_note": "Beat spacing was too ambiguous for a reliable tempo-stability judgment."}

    raw_bpm = 60.0 / np.maximum(intervals, 1e-6)
    fallback_anchor = float(np.median(60.0 / valid))
    anchor = float(global_bpm or fallback_anchor)
    normalized_bpm = np.asarray([_normalize_bpm(float(value), anchor) for value in raw_bpm], dtype=np.float64)
    window = min(8, max(4, len(normalized_bpm) // 8))
    local: list[dict[str, float]] = []
    for index in range(0, len(normalized_bpm) - window + 1):
        values = normalized_bpm[index:index + window]
        midpoint_beat = index + window // 2
        local.append({"ms": float(beats[min(midpoint_beat, len(beats) - 1)]), "bpm": float(np.median(values))})
    if not local:
        return {"status": "insufficient_evidence", "classification": "unknown", "beat_count": int(beats.size), "confidence": 0.0, "issues": [], "timeline": []}

    local_bpm = np.asarray([item["bpm"] for item in local], dtype=np.float64)
    if local_bpm.size >= 5:
        padded = np.pad(local_bpm, (2, 2), mode="edge")
        local_bpm = np.asarray([np.median(padded[i:i + 5]) for i in range(local_bpm.size)], dtype=np.float64)
    times_ms = np.asarray([item["ms"] for item in local], dtype=np.float64)
    baseline = float(np.median(local_bpm))
    deviation = np.abs(local_bpm - baseline)
    mad = float(np.median(deviation))
    p95_deviation = float(np.percentile(deviation, 95))
    bpm_p05, bpm_p95 = [float(value) for value in np.percentile(local_bpm, [5, 95])]
    bpm_span = bpm_p95 - bpm_p05
    jitter = float(np.median(np.abs(np.diff(local_bpm)))) if local_bpm.size > 1 else 0.0
    stable_tolerance = max(0.75, baseline * 0.008)
    stable_ratio = float(np.mean(deviation <= stable_tolerance))
    duration_minutes = max((times_ms[-1] - times_ms[0]) / 60000.0, 1e-6)
    x_minutes = (times_ms - times_ms[0]) / 60000.0
    slope = float(np.polyfit(x_minutes, local_bpm, 1)[0]) if local_bpm.size >= 6 else 0.0
    estimated_drift = slope * duration_minutes

    jump_candidates: list[dict[str, Any]] = []
    diff = np.diff(local_bpm)
    jump_threshold = max(1.5, baseline * 0.012)
    for index, delta in enumerate(diff):
        if abs(float(delta)) < jump_threshold:
            continue
        ms = int(round(times_ms[index + 1]))
        boundary_distance = _section_boundary_distance(ms, sections)
        jump_candidates.append({
            "ms": ms,
            "delta_bpm": round(float(delta), 2),
            "from_bpm": round(float(local_bpm[index]), 2),
            "to_bpm": round(float(local_bpm[index + 1]), 2),
            "section_aligned": boundary_distance is not None and boundary_distance <= 2200,
            "nearest_section_boundary_ms": boundary_distance,
        })
    collapsed_jumps: list[dict[str, Any]] = []
    for item in jump_candidates:
        if collapsed_jumps and item["ms"] - collapsed_jumps[-1]["ms"] < 5000:
            if abs(item["delta_bpm"]) > abs(collapsed_jumps[-1]["delta_bpm"]):
                collapsed_jumps[-1] = item
            continue
        collapsed_jumps.append(item)

    aligned_changes = [item for item in collapsed_jumps if item["section_aligned"]]
    unaligned_changes = [item for item in collapsed_jumps if not item["section_aligned"]]
    drift_detected = abs(estimated_drift) >= max(1.25, baseline * 0.01)
    random_instability = jitter >= max(0.45, baseline * 0.004) and p95_deviation >= max(1.2, baseline * 0.01)
    meaningfully_variable = bpm_span >= max(1.5, baseline * 0.012)

    section_tempos: list[dict[str, Any]] = []
    for section in sections:
        if not isinstance(section, dict):
            continue
        start = int(section.get("start_ms") or 0)
        end = int(section.get("end_ms") or 0)
        mask = (times_ms >= start) & (times_ms < end)
        values = local_bpm[mask]
        if values.size < 4:
            continue
        section_tempos.append({
            "section_id": section.get("id"), "label": section.get("label") or section.get("type") or "Section",
            "start_ms": start, "end_ms": end,
            "median_bpm": round(float(np.median(values)), 3),
            "span_bpm": round(float(np.percentile(values, 90) - np.percentile(values, 10)), 3),
        })
    section_change_threshold = max(1.5, baseline * 0.012)
    section_steps: list[dict[str, Any]] = []
    for left, right in zip(section_tempos[:-1], section_tempos[1:]):
        delta = float(right["median_bpm"]) - float(left["median_bpm"])
        if abs(delta) < section_change_threshold:
            continue
        if float(left["span_bpm"]) <= section_change_threshold and float(right["span_bpm"]) <= section_change_threshold:
            section_steps.append({
                "ms": int(right["start_ms"]), "delta_bpm": round(delta, 2),
                "from_bpm": left["median_bpm"], "to_bpm": right["median_bpm"],
                "from_section": left["label"], "to_section": right["label"],
            })

    if section_steps and not random_instability and not unaligned_changes:
        classification = "section_tempo_changes"
    elif unaligned_changes or random_instability:
        classification = "unstable"
    elif drift_detected:
        classification = "drifting"
    elif meaningfully_variable:
        classification = "unstable"
    else:
        classification = "stable"

    issues: list[dict[str, Any]] = []
    if classification == "unstable":
        worst = max(unaligned_changes, key=lambda item: abs(item["delta_bpm"]), default=None)
        issues.append(_issue(
            severity="review", category="creative_observation", code="beat_instability",
            message=f"Tempo is not staying consistently locked around {baseline:.1f} BPM. The central 90% spans about {bpm_p05:.1f}–{bpm_p95:.1f} BPM.",
            start_ms=worst["ms"] if worst else None, end_ms=(worst["ms"] + 8000) if worst else None,
            evidence={"median_bpm": round(baseline, 2), "p05_bpm": round(bpm_p05, 2), "p95_bpm": round(bpm_p95, 2), "jitter_bpm": round(jitter, 2)},
        ))
    elif classification == "drifting":
        issues.append(_issue(
            severity="review", category="creative_observation", code="tempo_drift",
            message=f"Tempo shows a gradual drift of about {estimated_drift:+.1f} BPM across the analyzed beat grid instead of remaining fixed.",
            evidence={"median_bpm": round(baseline, 2), "drift_bpm": round(estimated_drift, 2), "slope_bpm_per_minute": round(slope, 3)},
        ))
    elif classification == "section_tempo_changes":
        issues.append(_issue(
            severity="info", category="creative_observation", code="section_tempo_change",
            message="Tempo changes are detectable, but the strongest changes align with musical section boundaries. Review them as a possible intentional arrangement choice rather than a mastering defect.",
            start_ms=(section_steps or aligned_changes)[0]["ms"] if (section_steps or aligned_changes) else None,
            end_ms=((section_steps or aligned_changes)[0]["ms"] + 8000) if (section_steps or aligned_changes) else None,
            evidence={"changes": (section_steps or aligned_changes)[:4]},
        ))

    rhythm_conf = max(0.0, min(1.0, float(rhythm_confidence or 0.55)))
    evidence_factor = min(1.0, len(beats) / 96.0)
    confidence = 0.72 * rhythm_conf + 0.28 * evidence_factor
    timeline: list[dict[str, Any]] = []
    stride = max(1, int(math.ceil(len(local_bpm) / 180)))
    for index in range(0, len(local_bpm), stride):
        timeline.append({"ms": int(round(times_ms[index])), "bpm": round(float(local_bpm[index]), 3), "deviation_bpm": round(float(local_bpm[index] - baseline), 3)})
    return {
        "status": "completed", "classification": classification, "beat_count": int(beats.size),
        "median_bpm": round(baseline, 3), "p05_bpm": round(bpm_p05, 3), "p95_bpm": round(bpm_p95, 3),
        "central_90_span_bpm": round(bpm_span, 3), "median_absolute_deviation_bpm": round(mad, 3),
        "p95_deviation_bpm": round(p95_deviation, 3), "local_jitter_bpm": round(jitter, 3),
        "stable_ratio": round(stable_ratio, 4), "slope_bpm_per_minute": round(slope, 4),
        "estimated_end_to_end_drift_bpm": round(estimated_drift, 3), "tempo_changes": collapsed_jumps[:12],
        "section_tempos": section_tempos, "section_tempo_steps": section_steps, "timeline": timeline,
        "confidence": round(max(0.0, min(1.0, confidence)), 4), "issues": issues,
        "analysis_note": "Tempo stability is derived from robust local medians of canonical beat intervals. Section-aligned changes are separated from unaligned drift/jitter so creative tempo automation is not treated as a technical defect.",
    }


def _codec_stress(path: Path, source_loudness: dict[str, Any]) -> list[dict[str, Any]]:
    codecs = [
        ("aac_256", ["-c:a", "aac", "-b:a", "256k"], ".m4a"),
        ("opus_160", ["-c:a", "libopus", "-b:a", "160k", "-vbr", "on"], ".opus"),
        ("vorbis_q5", ["-c:a", "libvorbis", "-q:a", "5"], ".ogg"),
    ]
    source_peak = _finite(source_loudness.get("true_peak_dbtp"))
    source_lufs = _finite(source_loudness.get("integrated_lufs"))
    results: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="ensemblis-codec-") as directory:
        root = Path(directory)
        for name, encoder_args, suffix in codecs:
            output = root / f"{name}{suffix}"
            encoded = _run_ffmpeg(["-loglevel", "error", "-y", "-i", str(path), "-vn", *encoder_args, str(output)], timeout=120)
            if encoded.returncode != 0 or not output.exists():
                results.append({"profile": name, "status": "unavailable", "reason": encoded.stderr[-300:] or "encoder_not_available"})
                continue
            measured = _measure_ebur128(output)
            encoded_peak = _finite(measured.get("true_peak_dbtp"))
            encoded_lufs = _finite(measured.get("integrated_lufs"))
            results.append({
                "profile": name, "status": measured.get("status"),
                "integrated_lufs": measured.get("integrated_lufs"), "true_peak_dbtp": measured.get("true_peak_dbtp"),
                "true_peak_delta_db": _round(encoded_peak - source_peak, 3) if encoded_peak is not None and source_peak is not None else None,
                "loudness_delta_lu": _round(encoded_lufs - source_lufs, 3) if encoded_lufs is not None and source_lufs is not None else None,
                "overs_zero_dbtp": encoded_peak is not None and encoded_peak > 0.0,
                "very_low_headroom": encoded_peak is not None and encoded_peak > -0.3,
            })
    return results


def _spotify_playback(integrated_lufs: float | None, true_peak_dbtp: float | None) -> dict[str, Any]:
    playback = {}
    for name, target in {"loud": -11.0, "normal": -14.0, "quiet": -19.0}.items():
        gain = target - integrated_lufs if integrated_lufs is not None else None
        playback[name] = {
            "target_lufs": target,
            "estimated_gain_db": _round(gain, 2),
            "estimated_post_gain_true_peak_dbtp": _round(true_peak_dbtp + gain, 2) if true_peak_dbtp is not None and gain is not None else None,
            "note": "Spotify applies playback normalization; Loud mode may use a limiter.",
        }
    return {
        "profile_version": SPOTIFY_PROFILE_VERSION,
        "profiles": playback,
        "guidance": {"normal_target_lufs": -14.0, "recommended_max_true_peak_dbtp": -1.0, "recommended_loud_master_true_peak_dbtp": -2.0, "loud_master_threshold_lufs": -14.0},
    }


def _evaluate(*, format_info: dict[str, Any], loudness: dict[str, Any], sample_qc: dict[str, Any],
              stereo: dict[str, Any], stereo_windows: list[dict[str, Any]], spectral: dict[str, Any],
              beat_stability: dict[str, Any], codec_stress: list[dict[str, Any]]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    clipping_samples = int(sample_qc.get("clipping_samples") or 0)
    if clipping_samples > 0:
        issues.append(_issue(severity="critical", category="technical_defect", code="digital_clipping", message=f"Detected {clipping_samples} samples at or above digital full scale.", start_ms=int(sample_qc.get("sample_peak_ms") or 0), end_ms=int(sample_qc.get("sample_peak_ms") or 0) + 3000, evidence={"clipping_samples": clipping_samples}))

    true_peak = _finite(loudness.get("true_peak_dbtp"))
    integrated = _finite(loudness.get("integrated_lufs"))
    if true_peak is not None and true_peak > -0.3:
        issues.append(_issue(severity="review", category="platform_risk", code="true_peak_hot", message=f"True peak reaches {true_peak:.2f} dBTP, leaving very little reconstruction/codec headroom.", start_ms=int(sample_qc.get("sample_peak_ms") or 0), end_ms=int(sample_qc.get("sample_peak_ms") or 0) + 3000, evidence={"true_peak_dbtp": round(true_peak, 3)}))
    elif true_peak is not None and integrated is not None and integrated > -14.0 and true_peak > -2.0:
        issues.append(_issue(severity="review", category="platform_risk", code="spotify_loud_master_headroom", message=f"This is a loud master ({integrated:.1f} LUFS) with {true_peak:.2f} dBTP true peak. Spotify's artist guidance recommends more true-peak headroom for masters louder than -14 LUFS.", evidence={"integrated_lufs": round(integrated, 2), "true_peak_dbtp": round(true_peak, 3)}))

    if int(format_info.get("channels") or 0) != 2:
        issues.append(_issue(severity="review", category="technical_defect", code="delivery_channels", message=f"Delivery master has {int(format_info.get('channels') or 0)} channel(s); verify that a stereo master is intended for distribution.", evidence={"channels": format_info.get("channels")}))
    bit_depth = format_info.get("bit_depth")
    if isinstance(bit_depth, int) and bit_depth < 16:
        issues.append(_issue(severity="review", category="technical_defect", code="delivery_bit_depth", message=f"Detected {bit_depth}-bit source audio. Verify that the highest-quality export is being delivered.", evidence={"bit_depth": bit_depth}))
    flat_run = _finite(sample_qc.get("max_near_full_scale_run_ms"))
    if flat_run is not None and flat_run >= 0.75:
        issues.append(_issue(severity="review", category="creative_observation", code="possible_flat_topping", message=f"Near-full-scale samples remain pinned for about {flat_run:.2f} ms at the longest run; inspect limiter flat-topping.", start_ms=int(sample_qc.get("sample_peak_ms") or 0), end_ms=int(sample_qc.get("sample_peak_ms") or 0) + 3000, evidence={"max_near_full_scale_run_ms": round(flat_run, 3)}))
    if float(sample_qc.get("dc_offset") or 0.0) > 0.01:
        issues.append(_issue(severity="review", category="technical_defect", code="dc_offset", message=f"DC offset reaches {float(sample_qc['dc_offset']):.4f}; inspect the render/master chain."))
    if int(sample_qc.get("leading_silence_ms") or 0) > 1500:
        issues.append(_issue(severity="review", category="technical_defect", code="leading_silence", message=f"Leading silence is {float(sample_qc['leading_silence_ms']) / 1000.0:.1f}s.", start_ms=0, end_ms=int(sample_qc["leading_silence_ms"])))
    if int(sample_qc.get("trailing_silence_ms") or 0) > 5000:
        issues.append(_issue(severity="review", category="technical_defect", code="trailing_silence", message=f"Trailing silence is {float(sample_qc['trailing_silence_ms']) / 1000.0:.1f}s."))

    correlation = _finite(stereo.get("correlation"))
    if correlation is not None and correlation < -0.2:
        issues.append(_issue(severity="review", category="technical_defect", code="phase_risk", message=f"Overall stereo correlation is {correlation:.2f}; audition mono compatibility.", evidence={"stereo_correlation": round(correlation, 4)}))
    worst_mono = min(stereo_windows, key=lambda item: float(item.get("mono_fold_down_delta_db") or 0.0), default=None)
    if worst_mono and float(worst_mono.get("mono_fold_down_delta_db") or 0.0) < -3.0:
        issues.append(_issue(severity="review", category="technical_defect", code="localized_mono_loss", message=f"Mono fold-down loses about {abs(float(worst_mono['mono_fold_down_delta_db'])):.1f} dB in the most phase-sensitive window.", start_ms=int(worst_mono["start_ms"]), end_ms=int(worst_mono["end_ms"]), evidence={"mono_fold_down_delta_db": worst_mono["mono_fold_down_delta_db"]}))
    low_band_side = max(float((stereo.get("band_side_share") or {}).get("sub_20_80") or 0.0), float((stereo.get("band_side_share") or {}).get("bass_80_180") or 0.0))
    if low_band_side > 0.38:
        issues.append(_issue(severity="review", category="creative_observation", code="wide_low_end", message="A large share of low-frequency energy is in the Side channel. Check low-end translation and mono playback.", evidence={"low_frequency_side_share": round(low_band_side, 4)}))
    issues.extend(beat_stability.get("issues") or [])

    stressed = [item for item in codec_stress if item.get("status") == "completed" and item.get("very_low_headroom")]
    if stressed:
        worst = max(stressed, key=lambda item: float(item.get("true_peak_dbtp") or -99.0))
        issues.append(_issue(severity="review", category="platform_risk", code="codec_headroom", message=f"Codec stress test raises reconstructed true peak to {float(worst['true_peak_dbtp']):.2f} dBTP in the {worst['profile']} preview.", evidence={"codec_profile": worst["profile"], "true_peak_dbtp": worst["true_peak_dbtp"]}))
    if spectral.get("band_relative_db"):
        issues.append(_issue(severity="info", category="creative_observation", code="tonal_profile_available", message="Tonal balance is ready for loudness-matched comparison against the artist catalog/reference masters."))
    return issues


def analyze_mastering(
    path: Path,
    music_map: dict[str, Any],
    *,
    include_codec_stress: bool = True,
    include_section_signatures: bool = True,
) -> dict[str, Any]:
    try:
        audio, sample_rate = sf.read(str(path), always_2d=True, dtype="float32")
    except Exception as exc:
        issue = _issue(severity="critical", category="technical_defect", code="decode_failed", message=f"Mastering Inspector could not decode the source audio: {str(exc)[:180]}")
        return {"schema": MASTERING_SCHEMA, "compatibility": {"legacy_schema": MASTERING_LEGACY_SCHEMA, "legacy_fields_preserved": True}, "status": "fix_before_release", "technical_ready": False, "issues": [issue], "beat_stability": analyze_beat_stability([int(value) for value in music_map.get("beats_ms") or []], global_bpm=_finite(music_map.get("bpm")), sections=[item for item in music_map.get("sections") or [] if isinstance(item, dict)], rhythm_confidence=_finite((((music_map.get("analysis") or {}).get("confidence") or {}).get("rhythm"))))}
    if audio.size == 0:
        issue = _issue(severity="critical", category="technical_defect", code="empty_audio", message="The decoded master contains no audio samples.")
        return {"schema": MASTERING_SCHEMA, "compatibility": {"legacy_schema": MASTERING_LEGACY_SCHEMA, "legacy_fields_preserved": True}, "status": "fix_before_release", "technical_ready": False, "issues": [issue]}

    format_info = _format_info(path, sample_rate, audio.shape[1])
    sample_qc = _sample_qc(audio, sample_rate)
    loudness = _measure_ebur128(path)
    fallback_true_peak, fallback_true_peak_channel = _true_peak_fallback(audio, sample_rate)
    if loudness.get("status") != "completed":
        crosscheck_for_primary = _pyloudnorm_crosscheck(audio, sample_rate)
        loudness = {**loudness, "integrated_lufs": crosscheck_for_primary.get("integrated_lufs"), "loudness_range_lu": crosscheck_for_primary.get("loudness_range_lu"), "true_peak_dbtp": _round(fallback_true_peak, 3), "true_peak_channel": fallback_true_peak_channel, "standard_fallback": True}
    else:
        loudness["true_peak_channel"] = fallback_true_peak_channel

    crosscheck = _pyloudnorm_crosscheck(audio, sample_rate)
    canonical_lufs = _finite(loudness.get("integrated_lufs"))
    check_lufs = _finite(crosscheck.get("integrated_lufs"))
    crosscheck["integrated_delta_lu"] = _round(check_lufs - canonical_lufs, 3) if canonical_lufs is not None and check_lufs is not None else None
    stereo, stereo_windows = _windowed_stereo(audio, sample_rate)
    spectral = _spectral_profile(audio, sample_rate)
    transients = _transient_profile(audio, sample_rate)
    dynamics = _dynamics(audio, sample_rate, loudness, sample_qc)
    sections = [item for item in music_map.get("sections") or [] if isinstance(item, dict)]
    section_signatures = (
        _section_mastering_signatures(audio, sample_rate, sections)
        if include_section_signatures
        else []
    )
    rhythm_confidence = _finite((((music_map.get("analysis") or {}).get("confidence") or {}).get("rhythm")))
    beat_stability = analyze_beat_stability([int(value) for value in music_map.get("beats_ms") or []], global_bpm=_finite(music_map.get("bpm")), sections=sections, rhythm_confidence=rhythm_confidence)
    temporal_stability = _temporal_stability(audio, sample_rate, sections)
    codec_stress = _codec_stress(path, loudness) if include_codec_stress else []
    issues = _evaluate(format_info=format_info, loudness=loudness, sample_qc=sample_qc, stereo=stereo, stereo_windows=stereo_windows, spectral=spectral, beat_stability=beat_stability, codec_stress=codec_stress)
    critical = [item for item in issues if item.get("severity") == "critical"]
    review = [item for item in issues if item.get("severity") == "review"]
    temporal_review = [item for item in temporal_stability.get("findings") or [] if item.get("severity") == "review"]
    status = "fix_before_release" if critical else "ready_review_suggested" if (review or temporal_review) else "ready"
    technical_ready = not critical
    integrated = _finite(loudness.get("integrated_lufs"))
    true_peak = _finite(loudness.get("true_peak_dbtp"))

    return {
        "schema": MASTERING_SCHEMA,
        "compatibility": {
            "legacy_schema": MASTERING_LEGACY_SCHEMA,
            "legacy_fields_preserved": True,
        },
        "status": status, "technical_ready": technical_ready,
        "measurement_engine": {"canonical": "ffmpeg-ebur128", "canonical_standard": "ITU-R BS.1770 / EBU R128", "crosscheck": "pyloudnorm", "true_peak_fallback": "4x soxr oversampling"},
        "format": format_info, "loudness": loudness, "loudness_crosscheck": crosscheck,
        "peaks": {**sample_qc, "true_peak_dbtp": loudness.get("true_peak_dbtp"), "true_peak_channel": loudness.get("true_peak_channel")},
        "dynamics": dynamics, "transients": transients, "stereo": stereo, "stereo_timeline": stereo_windows, "tonal_balance": spectral,
        "beat_stability": beat_stability, "temporal_stability": temporal_stability, "codec_stress": codec_stress,
        "platform_previews": {"spotify": _spotify_playback(integrated, true_peak)},
        "analysis_scope": "full" if include_codec_stress else "candidate_core",
        "reference_signature": {
            "integrated_lufs": loudness.get("integrated_lufs"), "true_peak_dbtp": loudness.get("true_peak_dbtp"),
            "loudness_range_lu": dynamics.get("loudness_range_lu"), "peak_to_loudness_ratio_lu": dynamics.get("peak_to_loudness_ratio_lu"),
            "crest_factor_db": dynamics.get("crest_factor_db"), "band_relative_db": spectral.get("band_relative_db"),
            "perceptual_envelope_db": spectral.get("perceptual_envelope_db"),
            "transient_crest_p90_db": transients.get("transient_crest_p90_db"),
            "onset_density_per_second": transients.get("onset_density_per_second"),
            "stereo_correlation": stereo.get("correlation"), "band_side_share": stereo.get("band_side_share"),
            "tempo_median_bpm": beat_stability.get("median_bpm"), "tempo_span_bpm": beat_stability.get("central_90_span_bpm"),
            "tempo_classification": beat_stability.get("classification"),
            "section_signatures": section_signatures,
        },
        "issues": issues,
        "issue_counts": {"critical": len(critical), "review": len(review) + len(temporal_review), "info": len([item for item in issues if item.get("severity") == "info"])},
        "analysis_note": "Measurement and judgment are separated. Technical defects and platform risks are deterministic; tonal/dynamic differences are descriptive unless a reference or artist-catalog baseline supports the comparison.",
    }


def enrich_music_map_with_mastering(result: dict[str, Any], path: Path) -> dict[str, Any]:
    mastering = analyze_mastering(path, result)
    beat_stability = mastering.get("beat_stability") if isinstance(mastering.get("beat_stability"), dict) else {}
    beat_shadow = ((((result.get("rhythm_consensus") or {}).get("shadow_providers") or {}).get("beat_this")) if isinstance(result.get("rhythm_consensus"), dict) else None)
    if isinstance(beat_shadow, dict):
        beat_stability["provider_crosscheck"] = {
            "provider": "beat_this", "status": beat_shadow.get("status"), "overall_agreement": beat_shadow.get("overall_agreement"),
            "median_beat_error_ms": beat_shadow.get("median_beat_error_ms"), "median_downbeat_error_ms": beat_shadow.get("median_downbeat_error_ms"),
            "promotion_policy": beat_shadow.get("promotion_policy"),
        }
    mastering["beat_stability"] = beat_stability
    result["mastering_inspector"] = mastering
    result["beat_stability"] = beat_stability
    result["master_qc"] = {
        "technical_ready": mastering.get("technical_ready"), "integrated_lufs": (mastering.get("loudness") or {}).get("integrated_lufs"),
        "sample_peak_dbfs": (mastering.get("peaks") or {}).get("sample_peak_dbfs"), "true_peak_dbtp": (mastering.get("peaks") or {}).get("true_peak_dbtp"),
        "rms_dbfs": (mastering.get("peaks") or {}).get("rms_dbfs"), "crest_factor_db": (mastering.get("peaks") or {}).get("crest_factor_db"),
        "clipping_samples": (mastering.get("peaks") or {}).get("clipping_samples"),
        "clipping_ratio": float((mastering.get("peaks") or {}).get("clipping_samples") or 0) / max(1, int((mastering.get("format") or {}).get("frames") or 1) * int((mastering.get("format") or {}).get("channels") or 1)),
        "stereo_correlation": (mastering.get("stereo") or {}).get("correlation"), "dc_offset": (mastering.get("peaks") or {}).get("dc_offset"),
        "leading_silence_ms": (mastering.get("peaks") or {}).get("leading_silence_ms"), "trailing_silence_ms": (mastering.get("peaks") or {}).get("trailing_silence_ms"),
        "sample_rate_hz": (mastering.get("format") or {}).get("sample_rate_hz"), "channels": (mastering.get("format") or {}).get("channels"),
        "issues": [item for item in mastering.get("issues") or [] if item.get("category") in {"technical_defect", "platform_risk"}],
        "analysis_note": "Canonical Mastering Inspector measurements; see mastering_inspector for full evidence.",
    }
    mix = result.setdefault("mix_intelligence", {})
    mix["technical_ready"] = mastering.get("technical_ready")
    mix["loudness"] = {
        "integrated_lufs": (mastering.get("loudness") or {}).get("integrated_lufs"), "true_peak_dbtp": (mastering.get("loudness") or {}).get("true_peak_dbtp"),
        "loudness_range_lu": (mastering.get("loudness") or {}).get("loudness_range_lu"), "peak_to_loudness_ratio_lu": (mastering.get("dynamics") or {}).get("peak_to_loudness_ratio_lu"),
    }
    mix["dynamics"] = mastering.get("dynamics")
    mix["spectrum"] = mastering.get("tonal_balance")
    mix["stereo"] = mastering.get("stereo")
    mix["observations"] = mastering.get("issues")
    mix["confidence"] = 0.96 if (mastering.get("loudness") or {}).get("status") == "completed" else 0.78
    mix["analysis_note"] = "Mastering Inspector v1 deterministic measurements and review cues."
    result.setdefault("rhythm_consensus", {})["beat_stability"] = beat_stability
    return result
