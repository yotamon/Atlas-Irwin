from __future__ import annotations

import importlib
import json
import platform
import site
import struct
import sys
from pathlib import Path

EXPECTED_PE_MACHINE = 0xAA64
REQUIRED_MODULES = (
    "PyInstaller",
    "numpy",
    "scipy",
    "sklearn",
    "numba",
    "llvmlite",
    "librosa",
    "soundfile",
    "pyloudnorm",
    "soxr",
    "imageio_ffmpeg",
    "python_stretch",
)


def _normalize_machine(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in {"arm64", "aarch64"}:
        return "aarch64"
    if normalized in {"amd64", "x86_64"}:
        return "x86_64"
    return normalized


def _pe_machine(path: Path) -> int:
    with path.open("rb") as handle:
        if handle.read(2) != b"MZ":
            raise RuntimeError(f"native dependency is not a PE file: {path}")
        handle.seek(0x3C)
        offset_raw = handle.read(4)
        if len(offset_raw) != 4:
            raise RuntimeError(f"truncated DOS header: {path}")
        handle.seek(struct.unpack("<I", offset_raw)[0])
        if handle.read(4) != b"PE\x00\x00":
            raise RuntimeError(f"invalid PE signature: {path}")
        machine_raw = handle.read(2)
        if len(machine_raw) != 2:
            raise RuntimeError(f"truncated COFF header: {path}")
        return struct.unpack("<H", machine_raw)[0]


def _native_files() -> list[Path]:
    roots = [Path(path).resolve() for path in site.getsitepackages() if Path(path).is_dir()]
    found: set[Path] = set()
    for root in roots:
        for suffix in ("*.pyd", "*.dll", "*.exe"):
            found.update(path.resolve() for path in root.rglob(suffix) if path.is_file())
    return sorted(found)


def main() -> int:
    machine = _normalize_machine(platform.machine())
    if machine != "aarch64":
        raise RuntimeError(f"Windows ARM64 dependency verification requires an ARM64 Python host, got {machine}")

    versions: dict[str, str] = {}
    for name in REQUIRED_MODULES:
        module = importlib.import_module(name)
        versions[name] = str(getattr(module, "__version__", "unknown"))

    native_files = _native_files()
    if not native_files:
        raise RuntimeError("no native Python dependency binaries were found to verify")

    mismatches: list[str] = []
    for path in native_files:
        machine_id = _pe_machine(path)
        if machine_id != EXPECTED_PE_MACHINE:
            mismatches.append(f"{path}: PE machine 0x{machine_id:04x}")

    if mismatches:
        joined = "\n".join(mismatches[:40])
        raise RuntimeError(f"non-ARM64 binaries detected in Python environment:\n{joined}")

    print(
        json.dumps(
            {
                "host": machine,
                "verifiedNativeFiles": len(native_files),
                "versions": versions,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
