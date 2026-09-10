from __future__ import annotations

import argparse
import json
import os
import shutil
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


def host_triple() -> str:
    configured = os.environ.get("TAURI_ENV_TARGET_TRIPLE", "").strip()
    if configured:
        return configured
    output = subprocess.check_output(["rustc", "--print", "host-tuple"], text=True).strip()
    if not output:
        raise RuntimeError("could not determine the Rust host target triple")
    return output


def build(target_triple: str) -> Path:
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

    version_output = subprocess.check_output([str(target), "version", "--json"], text=True).strip()
    payload = json.loads(version_output)
    for key, expected in EXPECTED_VERSIONS.items():
        if payload.get(key) != expected:
            raise RuntimeError(f"sidecar contract mismatch for {key}: {payload.get(key)!r}")
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the Ensemblis Library Bridge sidecar for Tauri externalBin")
    parser.add_argument("--target-triple", default=None)
    args = parser.parse_args()
    target = build(args.target_triple or host_triple())
    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
