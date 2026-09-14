from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

from build_sidecar import assert_target_binary_architecture

WINDOWS_ARM64_TARGET = "aarch64-pc-windows-msvc"
WINDOWS_ARM64_ARCHIVE = "ffmpeg-n9.0.1-29-gad500d59cb-winarm64-lgpl-9.0.zip"
WINDOWS_ARM64_SHA256 = "9f33212fbd3a74913034d6f535d712a48969ac5115ccaaae312120c92f517904"
WINDOWS_ARM64_URL = (
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/"
    "autobuild-2026-09-13-14-50/"
    f"{WINDOWS_ARM64_ARCHIVE}"
)


def _download_verified(url: str, expected_sha256: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    request = urllib.request.Request(url, headers={"User-Agent": "Ensemblis-native-build/1"})
    with urllib.request.urlopen(request, timeout=120) as response, target.open("wb") as writer:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            writer.write(chunk)
        writer.flush()
        os.fsync(writer.fileno())
    actual = digest.hexdigest()
    if actual != expected_sha256:
        target.unlink(missing_ok=True)
        raise RuntimeError(f"FFmpeg archive checksum mismatch: expected {expected_sha256}, got {actual}")


def _extract_ffmpeg(archive: Path, output: Path) -> None:
    with zipfile.ZipFile(archive) as bundle:
        candidates = [
            name
            for name in bundle.namelist()
            if name.replace("\\", "/").lower().endswith("/bin/ffmpeg.exe")
        ]
        if len(candidates) != 1:
            raise RuntimeError(f"expected exactly one ffmpeg.exe in pinned archive, found {len(candidates)}")
        output.parent.mkdir(parents=True, exist_ok=True)
        with bundle.open(candidates[0]) as reader, output.open("wb") as writer:
            shutil.copyfileobj(reader, writer)
            writer.flush()
            os.fsync(writer.fileno())


def prepare(target_triple: str, output: Path) -> Path:
    if target_triple != WINDOWS_ARM64_TARGET:
        raise ValueError(f"no pinned native FFmpeg package configured for {target_triple}")

    with tempfile.TemporaryDirectory(prefix="ensemblis-ffmpeg-") as directory:
        archive = Path(directory) / WINDOWS_ARM64_ARCHIVE
        _download_verified(WINDOWS_ARM64_URL, WINDOWS_ARM64_SHA256, archive)
        temp_output = Path(directory) / "ffmpeg.exe"
        _extract_ffmpeg(archive, temp_output)
        assert_target_binary_architecture(temp_output, target_triple)
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(temp_output, output)

    assert_target_binary_architecture(output, target_triple)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare a pinned native FFmpeg binary for Ensemblis packaging")
    parser.add_argument("--target-triple", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(prepare(args.target_triple, args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
