from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import struct
import subprocess
import sys
from pathlib import Path

SIDECAR_NAME = "ensemblis-bridge-sidecar"
EXPECTED_VERSIONS = {
    "version": "ensemblis.library-bridge.sidecar.v1",
    "analysisBatchVersion": "ensemblis.library-bridge.analysis-batch.v1",
    "analyzerVersion": "ensemblis.library-bridge.analyzer.v1",
    "rendererVersion": "ensemblis.library-bridge.renderer.v1",
}

WINDOWS_PE_MACHINES = {
    "x86_64-pc-windows-msvc": 0x8664,
    "aarch64-pc-windows-msvc": 0xAA64,
}

TARGET_HOST_ARCH = {
    "x86_64-pc-windows-msvc": "x86_64",
    "aarch64-pc-windows-msvc": "aarch64",
    "aarch64-apple-darwin": "aarch64",
    "x86_64-apple-darwin": "x86_64",
}


def host_triple() -> str:
    configured = os.environ.get("TAURI_ENV_TARGET_TRIPLE", "").strip()
    if configured:
        return configured
    output = subprocess.check_output(["rustc", "--print", "host-tuple"], text=True).strip()
    if not output:
        raise RuntimeError("could not determine the Rust host target triple")
    return output


def normalize_machine(machine: str) -> str:
    value = machine.strip().lower()
    if value in {"amd64", "x86_64"}:
        return "x86_64"
    if value in {"arm64", "aarch64"}:
        return "aarch64"
    return value


def assert_native_host(target_triple: str) -> None:
    expected = TARGET_HOST_ARCH.get(target_triple)
    if expected is None:
        return
    actual = normalize_machine(platform.machine())
    if actual != expected:
        raise RuntimeError(
            f"native sidecar build requires host architecture {expected} for {target_triple}, got {actual}"
        )


def read_pe_machine(path: Path) -> int:
    with path.open("rb") as handle:
        if handle.read(2) != b"MZ":
            raise RuntimeError(f"{path} is not a Windows PE executable")
        handle.seek(0x3C)
        pe_offset_bytes = handle.read(4)
        if len(pe_offset_bytes) != 4:
            raise RuntimeError(f"{path} has a truncated DOS header")
        pe_offset = struct.unpack("<I", pe_offset_bytes)[0]
        handle.seek(pe_offset)
        if handle.read(4) != b"PE\x00\x00":
            raise RuntimeError(f"{path} has an invalid PE signature")
        machine_bytes = handle.read(2)
        if len(machine_bytes) != 2:
            raise RuntimeError(f"{path} has a truncated PE COFF header")
        return struct.unpack("<H", machine_bytes)[0]


def assert_target_binary_architecture(path: Path, target_triple: str) -> None:
    expected_pe_machine = WINDOWS_PE_MACHINES.get(target_triple)
    if expected_pe_machine is None:
        return
    actual_pe_machine = read_pe_machine(path)
    if actual_pe_machine != expected_pe_machine:
        raise RuntimeError(
            f"binary architecture mismatch for {target_triple}: "
            f"expected PE machine 0x{expected_pe_machine:04x}, got 0x{actual_pe_machine:04x}"
        )


def build(target_triple: str) -> Path:
    assert_native_host(target_triple)

    renderer_dir = Path(__file__).resolve().parent
    repo_root = renderer_dir.parents[2]
    media_worker = repo_root / "services" / "media-worker"
    tauri_dir = renderer_dir.parent / "src-tauri"
    binaries_dir = tauri_dir / "binaries"
    build_root = renderer_dir / ".sidecar-build"
    dist_dir = build_root / "dist"
    work_dir = build_root / "work"
    spec_dir = build_root / "spec"
    shutil.rmtree(build_root, ignore_errors=True)
    binaries_dir.mkdir(parents=True, exist_ok=True)
    dist_dir.mkdir(parents=True)
    work_dir.mkdir(parents=True)
    spec_dir.mkdir(parents=True)

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        SIDECAR_NAME,
        "--distpath",
        str(dist_dir),
        "--workpath",
        str(work_dir),
        "--specpath",
        str(spec_dir),
        "--paths",
        str(renderer_dir),
        "--paths",
        str(media_worker),
        "--hidden-import",
        "python_stretch",
        "--collect-all",
        "imageio_ffmpeg",
        str(renderer_dir / "bridge_sidecar.py"),
    ]
    subprocess.run(command, cwd=repo_root, check=True)

    extension = ".exe" if os.name == "nt" else ""
    built = dist_dir / f"{SIDECAR_NAME}{extension}"
    if not built.is_file():
        raise RuntimeError("PyInstaller did not produce the Library Bridge sidecar")

    target = binaries_dir / f"{SIDECAR_NAME}-{target_triple}{extension}"
    shutil.copy2(built, target)
    if os.name != "nt":
        target.chmod(target.stat().st_mode | 0o111)

    assert_target_binary_architecture(target, target_triple)

    version_output = subprocess.check_output([str(target), "version", "--json"], text=True).strip()
    payload = json.loads(version_output)
    for key, expected in EXPECTED_VERSIONS.items():
        if payload.get(key) != expected:
            raise RuntimeError(f"sidecar contract mismatch for {key}: {payload.get(key)!r}")
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description="Build or verify an Ensemblis native binary for Tauri packaging")
    parser.add_argument("--target-triple", default=None)
    parser.add_argument("--verify-binary", type=Path, default=None)
    args = parser.parse_args()
    target_triple = args.target_triple or host_triple()

    if args.verify_binary is not None:
        assert_target_binary_architecture(args.verify_binary, target_triple)
        print(args.verify_binary)
        return 0

    target = build(target_triple)
    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
