from __future__ import annotations

import math
from typing import Any

import numpy as np

from .automix_model import SAMPLE_RATE


def _records(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _curve(points: Any, length: int, default_start: float, default_end: float) -> np.ndarray:
    records = _records(points)
    if len(records) < 2:
        return np.linspace(default_start, default_end, length, dtype=np.float32)
    xs = np.asarray([float(item.get("at") or 0.0) for item in records], dtype=np.float32)
    ys = np.asarray([float(item.get("value") or 0.0) for item in records], dtype=np.float32)
    phase = np.linspace(0.0, 1.0, length, dtype=np.float32)
    return np.interp(phase, xs, ys).astype(np.float32)


def _low_high(audio: np.ndarray, cutoff_hz: float = 180.0) -> tuple[np.ndarray, np.ndarray]:
    try:
        from scipy.signal import butter, sosfiltfilt
        sos = butter(4, cutoff_hz, btype="lowpass", fs=SAMPLE_RATE, output="sos")
        low = sosfiltfilt(sos, audio, axis=0).astype(np.float32, copy=False)
        return low, audio - low
    except Exception:
        return np.zeros_like(audio), audio


def _echo_tail(audio: np.ndarray, bpm: float, length: int, feedback: float = 0.48) -> np.ndarray:
    if length <= 0:
        return np.zeros((0, 2), dtype=np.float32)
    source = audio[-min(len(audio), max(64, int(SAMPLE_RATE * 60.0 / max(60.0, bpm)))):]
    if not len(source):
        return np.zeros((length, 2), dtype=np.float32)
    delay = max(1, int(round(SAMPLE_RATE * 60.0 / max(60.0, bpm) * 0.75)))
    out = np.zeros((length, 2), dtype=np.float32)
    seed = source[-min(len(source), length):]
    out[:len(seed)] += seed
    gain = max(0.0, min(0.72, feedback))
    for repeat in range(1, 5):
        start = repeat * delay
        if start >= length:
            break
        amount = min(len(seed), length - start)
        out[start:start + amount] += seed[:amount] * (gain ** repeat)
    out *= np.linspace(1.0, 0.0, length, dtype=np.float32)[:, None]
    return out


def _soft_guard(audio: np.ndarray, threshold: float = 0.985) -> np.ndarray:
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak <= threshold or peak <= 1e-9:
        return audio
    return (audio * (threshold / peak)).astype(np.float32, copy=False)


def mix_transition_v2(
    a: np.ndarray,
    b: np.ndarray,
    transition: dict[str, Any],
    a_bpm: float,
) -> np.ndarray:
    overlap_ms = int(transition.get("overlap_ms") or 0)
    length = min(len(a), len(b), int(round(overlap_ms * SAMPLE_RATE / 1000.0)))
    technique = str(transition.get("technique") or "drop_cut")
    if technique == "drop_cut" or length <= 0:
        return np.zeros((0, 2), dtype=np.float32)

    automation = transition.get("automation") if isinstance(transition.get("automation"), dict) else {}
    out_gain = _curve(automation.get("from_gain"), length, 1.0, 0.0)
    in_gain = _curve(automation.get("to_gain"), length, 0.0, 1.0)
    a_tail = a[-length:]
    b_head = b[:length]

    if technique == "echo_out":
        fx = automation.get("fx") if isinstance(automation.get("fx"), dict) else {}
        feedback = float(fx.get("feedback") or 0.48)
        echo = _echo_tail(a_tail, a_bpm, length, feedback)
        return _soft_guard(echo * out_gain[:, None] + b_head * in_gain[:, None])

    low_end = automation.get("low_end_handoff") if isinstance(automation.get("low_end_handoff"), dict) else None
    if low_end is not None:
        a_low, a_high = _low_high(a_tail, float(low_end.get("cutoff_hz") or 180.0))
        b_low, b_high = _low_high(b_head, float(low_end.get("cutoff_hz") or 180.0))
        from_low = _curve(low_end.get("from_gain"), length, 1.0, 0.0)
        to_low = _curve(low_end.get("to_gain"), length, 0.0, 1.0)
        mixed = (
            a_high * out_gain[:, None]
            + b_high * in_gain[:, None]
            + a_low * (out_gain * from_low)[:, None]
            + b_low * (in_gain * to_low)[:, None]
        )
        return _soft_guard(mixed.astype(np.float32, copy=False))

    mixed = a_tail * out_gain[:, None] + b_head * in_gain[:, None]
    return _soft_guard(mixed.astype(np.float32, copy=False))
