from __future__ import annotations

import hashlib
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf

fake_main = types.ModuleType("app.main")
fake_main.download = lambda *args, **kwargs: None
fake_main.upload_file = lambda *args, **kwargs: None
fake_main.sha256_file = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
with patch.dict(sys.modules, {"app.main": fake_main}):
    from app.mastering_inspector import _true_peak_fallback
    from app.mastering_processor import _render_explicit_limiter, _render_premaster


def _fixture_audio(sample_rate: int = 44100, seconds: float = 2.0) -> np.ndarray:
    frames = int(sample_rate * seconds)
    t = np.arange(frames, dtype=np.float64) / float(sample_rate)
    base = 0.48 * np.sin(2.0 * np.pi * 80.0 * t)
    base += 0.20 * np.sin(2.0 * np.pi * 1000.0 * t)
    transient = np.zeros_like(base)
    for center_seconds in (0.25, 0.75, 1.25, 1.75):
        center = int(center_seconds * sample_rate)
        length = min(180, frames - center)
        if length <= 0:
            continue
        transient[center:center + length] += np.linspace(0.9, 0.0, length, endpoint=False)
    mono = np.clip(base + transient, -0.98, 0.98).astype(np.float32)
    return np.column_stack((mono, mono)).astype(np.float32)


class MasteringV2AudioRenderTest(unittest.TestCase):
    def test_explicit_limiter_preserves_native_rate_and_ceiling(self) -> None:
        sample_rate = 44100
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.wav"
            output = root / "mastered.flac"
            sf.write(source, _fixture_audio(sample_rate), sample_rate, subtype="PCM_24")

            target = {
                "integrated_lufs": -10.0,
                "true_peak_dbtp": -1.2,
                "loudness_range": {"hard_max_gain_db": 6.0},
            }
            telemetry = _render_explicit_limiter(
                source,
                output,
                target,
                {"input_i": "-14.0"},
                sample_rate_hz=sample_rate,
            )

            rendered, rendered_rate = sf.read(output, always_2d=True, dtype="float32")
            true_peak_dbtp, _ = _true_peak_fallback(rendered, rendered_rate)
            info = sf.info(output)

            self.assertEqual(rendered_rate, sample_rate)
            self.assertEqual(info.subtype, "PCM_24")
            self.assertEqual(telemetry["engine"], "ffmpeg_oversampled_alimiter")
            self.assertEqual(int(telemetry["oversampled_rate_hz"]), sample_rate * 4)
            self.assertAlmostEqual(float(telemetry["applied_gain_db"]), 4.0, places=3)
            self.assertLessEqual(float(true_peak_dbtp), -0.9)

    def test_dynamic_resonance_filter_renders_with_bundled_ffmpeg(self) -> None:
        sample_rate = 48000
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.wav"
            output = root / "premaster.wav"
            sf.write(source, _fixture_audio(sample_rate), sample_rate, subtype="PCM_24")
            plan = {
                "highpass_hz": 0.0,
                "eq_moves": [],
                "resonance": {
                    "enabled": True,
                    "moves": [{
                        "frequency_hz": 3200.0,
                        "detector_q": 1.8,
                        "target_q": 1.8,
                        "range_db": 1.0,
                        "ratio": 2.0,
                        "attack_ms": 18.0,
                        "release_ms": 130.0,
                    }],
                },
                "compression": {"enabled": False},
                "stereo": {"enabled": False},
            }

            _render_premaster(
                source,
                output,
                plan,
                sample_rate_hz=sample_rate,
            )

            info = sf.info(output)
            self.assertEqual(info.samplerate, sample_rate)
            self.assertEqual(info.subtype, "PCM_24")

    def test_optional_character_filter_renders_with_bundled_ffmpeg(self) -> None:
        sample_rate = 48000
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.wav"
            output = root / "premaster-character.wav"
            sf.write(source, _fixture_audio(sample_rate), sample_rate, subtype="PCM_24")
            plan = {
                "highpass_hz": 0.0,
                "eq_moves": [],
                "resonance": {"enabled": False, "moves": []},
                "compression": {"enabled": False},
                "character": {
                    "enabled": True,
                    "type": "tanh",
                    "threshold": 0.98,
                    "output": 0.99,
                    "oversample": 4,
                },
                "stereo": {"enabled": False},
            }

            _render_premaster(
                source,
                output,
                plan,
                sample_rate_hz=sample_rate,
            )

            info = sf.info(output)
            self.assertEqual(info.samplerate, sample_rate)
            self.assertEqual(info.subtype, "PCM_24")

    def test_explicit_limiter_is_waveform_deterministic(self) -> None:
        sample_rate = 48000
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.wav"
            first = root / "first.flac"
            second = root / "second.flac"
            sf.write(source, _fixture_audio(sample_rate), sample_rate, subtype="PCM_24")
            target = {
                "integrated_lufs": -10.5,
                "true_peak_dbtp": -1.3,
                "loudness_range": {"hard_max_gain_db": 6.0},
            }
            measured = {"input_i": "-13.5"}

            _render_explicit_limiter(source, first, target, measured, sample_rate_hz=sample_rate)
            _render_explicit_limiter(source, second, target, measured, sample_rate_hz=sample_rate)

            audio_a, rate_a = sf.read(first, always_2d=True, dtype="float32")
            audio_b, rate_b = sf.read(second, always_2d=True, dtype="float32")
            self.assertEqual(rate_a, rate_b)
            self.assertEqual(audio_a.shape, audio_b.shape)
            self.assertTrue(np.array_equal(audio_a, audio_b))


if __name__ == "__main__":
    unittest.main()
