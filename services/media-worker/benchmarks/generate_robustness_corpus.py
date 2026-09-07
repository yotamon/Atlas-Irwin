from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import numpy as np
import soundfile as sf


def _build_variants():
    try:
        from audiomentations import AddGaussianNoise, Compose, Gain, HighPassFilter, LowPassFilter
    except ImportError as exc:  # pragma: no cover - benchmark-only dependency
        raise SystemExit(
            "Install services/media-worker/requirements-audio-benchmark.txt before generating a robustness corpus."
        ) from exc

    return {
        "gain_minus_6db": Compose([Gain(min_gain_db=-6.0, max_gain_db=-6.0, p=1.0)]),
        "low_noise": Compose([AddGaussianNoise(min_amplitude=0.0005, max_amplitude=0.0005, p=1.0)]),
        "highpass_35hz": Compose([HighPassFilter(min_cutoff_freq=35.0, max_cutoff_freq=35.0, p=1.0)]),
        "lowpass_16khz": Compose([LowPassFilter(min_cutoff_freq=16000.0, max_cutoff_freq=16000.0, p=1.0)]),
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: python benchmarks/generate_robustness_corpus.py MASTER.wav OUTPUT_DIR", file=sys.stderr)
        return 2

    source = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)

    audio, sample_rate = sf.read(str(source), always_2d=True, dtype="float32")
    if audio.size == 0:
        raise SystemExit("source audio is empty")

    # Audiomentations uses channels-first. These variants deliberately preserve time
    # and pitch so Track Intelligence structure/rhythm should remain stable.
    samples = np.asarray(audio.T, dtype=np.float32)
    random.seed(1337)
    np.random.seed(1337)

    manifest = {
        "source": str(source),
        "sample_rate": int(sample_rate),
        "policy": "identity_preserving_time_and_pitch",
        "seed": 1337,
        "variants": [],
    }
    for name, transform in _build_variants().items():
        transformed = transform(samples=samples.copy(), sample_rate=int(sample_rate))
        destination = output_dir / f"{source.stem}__{name}.wav"
        sf.write(str(destination), np.asarray(transformed).T, int(sample_rate), subtype="PCM_24")
        manifest["variants"].append({"name": name, "audio": str(destination)})

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(manifest_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
