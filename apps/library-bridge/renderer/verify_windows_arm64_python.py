from __future__ import annotations

import importlib
import importlib.metadata
import json
import platform
import struct
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

EXPECTED_PE_MACHINE = 0xAA64
REQUIRED_PACKAGES = {
    "PyInstaller": "pyinstaller",
    "numpy": "numpy",
    "scipy": "scipy",
    "sklearn": "scikit-learn",
    "numba": "numba",
    "llvmlite": "llvmlite",
    "librosa": "librosa",
    "soundfile": "soundfile",
    "pyloudnorm": "pyloudnorm",
    "soxr": "soxr",
    "imageio_ffmpeg": "imageio-ffmpeg",
    "python_stretch": "python-stretch",
}
NATIVE_RUNTIME_SUFFIXES = {".pyd", ".dll"}


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


def _dependency_closure(root_names: set[str]) -> dict[str, importlib.metadata.Distribution]:
    pending = [canonicalize_name(name) for name in root_names]
    resolved: dict[str, importlib.metadata.Distribution] = {}
    while pending:
        name = pending.pop()
        if name in resolved:
            continue
        distribution = importlib.metadata.distribution(name)
        resolved[name] = distribution
        for raw_requirement in distribution.requires or ():
            requirement = Requirement(raw_requirement)
            if requirement.marker is not None and not requirement.marker.evaluate({"extra": ""}):
                continue
            dependency = canonicalize_name(requirement.name)
            if dependency not in resolved:
                pending.append(dependency)
    return resolved


def _native_runtime_files(
    distributions: dict[str, importlib.metadata.Distribution],
) -> list[tuple[str, Path]]:
    found: dict[Path, str] = {}
    for distribution_name, distribution in distributions.items():
        for relative in distribution.files or ():
            if Path(str(relative)).suffix.lower() not in NATIVE_RUNTIME_SUFFIXES:
                continue
            path = Path(distribution.locate_file(relative)).resolve()
            if path.is_file():
                found[path] = distribution_name
    return sorted(((owner, path) for path, owner in found.items()), key=lambda item: str(item[1]).lower())


def main() -> int:
    machine = _normalize_machine(platform.machine())
    if machine != "aarch64":
        raise RuntimeError(f"Windows ARM64 dependency verification requires an ARM64 Python host, got {machine}")

    versions: dict[str, str] = {}
    for import_name, distribution_name in REQUIRED_PACKAGES.items():
        module = importlib.import_module(import_name)
        versions[distribution_name] = importlib.metadata.version(distribution_name)
        if module is None:
            raise RuntimeError(f"required runtime module could not be imported: {import_name}")

    distributions = _dependency_closure(set(REQUIRED_PACKAGES.values()))
    native_files = _native_runtime_files(distributions)
    if not native_files:
        raise RuntimeError("no native Python runtime dependency binaries were found to verify")

    mismatches: list[str] = []
    for owner, path in native_files:
        machine_id = _pe_machine(path)
        if machine_id != EXPECTED_PE_MACHINE:
            mismatches.append(f"{owner}: {path}: PE machine 0x{machine_id:04x}")

    if mismatches:
        joined = "\n".join(mismatches[:40])
        raise RuntimeError(f"non-ARM64 binaries detected in Python runtime dependencies:\n{joined}")

    print(
        json.dumps(
            {
                "host": machine,
                "verifiedDistributions": len(distributions),
                "verifiedNativeFiles": len(native_files),
                "versions": dict(sorted(versions.items())),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
