from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import urlparse

from build_sidecar import assert_target_binary_architecture

WINDOWS_ARM64_TARGET = "aarch64-pc-windows-msvc"
WINDOWS_ARM64_RELEASE_API = "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest"
WINDOWS_ARM64_ASSET = "ffmpeg-n9.0-latest-winarm64-lgpl-9.0.zip"
WINDOWS_ARM64_DOWNLOAD_PREFIX = "https://github.com/BtbN/FFmpeg-Builds/releases/download/"
MAX_RELEASE_METADATA_BYTES = 2 * 1024 * 1024
MAX_FFMPEG_ARCHIVE_BYTES = 256 * 1024 * 1024
SHA256_DIGEST = re.compile(r"^sha256:([0-9a-f]{64})$")


def _github_request(url: str) -> urllib.request.Request:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Ensemblis-native-build/1",
    }
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return urllib.request.Request(url, headers=headers)


def _resolve_windows_arm64_asset() -> tuple[str, str, int]:
    with urllib.request.urlopen(_github_request(WINDOWS_ARM64_RELEASE_API), timeout=30) as response:
        payload = response.read(MAX_RELEASE_METADATA_BYTES + 1)
    if len(payload) > MAX_RELEASE_METADATA_BYTES:
        raise RuntimeError("FFmpeg release metadata exceeds the safety budget")

    release = json.loads(payload)
    assets = [
        asset
        for asset in release.get("assets", [])
        if asset.get("name") == WINDOWS_ARM64_ASSET
    ]
    if len(assets) != 1:
        raise RuntimeError(
            f"expected exactly one {WINDOWS_ARM64_ASSET} asset in the current BtbN release, found {len(assets)}"
        )

    asset = assets[0]
    url = str(asset.get("browser_download_url") or "")
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.hostname != "github.com"
        or not url.startswith(WINDOWS_ARM64_DOWNLOAD_PREFIX)
        or not parsed.path.endswith(f"/{WINDOWS_ARM64_ASSET}")
    ):
        raise RuntimeError("FFmpeg release returned an unexpected download URL")

    digest = str(asset.get("digest") or "").lower()
    match = SHA256_DIGEST.fullmatch(digest)
    if not match:
        raise RuntimeError("FFmpeg release asset is missing a valid GitHub SHA-256 digest")

    size = asset.get("size")
    if not isinstance(size, int) or size <= 0 or size > MAX_FFMPEG_ARCHIVE_BYTES:
        raise RuntimeError("FFmpeg release asset size is outside the safety budget")

    return url, match.group(1), size


def _download_verified(url: str, expected_sha256: str, expected_size: int, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    written = 0
    request = _github_request(url)
    with urllib.request.urlopen(request, timeout=120) as response, target.open("wb") as writer:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > expected_size:
                target.unlink(missing_ok=True)
                raise RuntimeError("FFmpeg archive exceeded the declared release size")
            digest.update(chunk)
            writer.write(chunk)
        writer.flush()
        os.fsync(writer.fileno())

    if written != expected_size:
        target.unlink(missing_ok=True)
        raise RuntimeError(f"FFmpeg archive size mismatch: expected {expected_size}, got {written}")

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
            raise RuntimeError(f"expected exactly one ffmpeg.exe in verified archive, found {len(candidates)}")
        output.parent.mkdir(parents=True, exist_ok=True)
        with bundle.open(candidates[0]) as reader, output.open("wb") as writer:
            shutil.copyfileobj(reader, writer)
            writer.flush()
            os.fsync(writer.fileno())


def prepare(target_triple: str, output: Path) -> Path:
    if target_triple != WINDOWS_ARM64_TARGET:
        raise ValueError(f"no verified native FFmpeg channel configured for {target_triple}")

    url, expected_sha256, expected_size = _resolve_windows_arm64_asset()
    with tempfile.TemporaryDirectory(prefix="ensemblis-ffmpeg-") as directory:
        archive = Path(directory) / WINDOWS_ARM64_ASSET
        _download_verified(url, expected_sha256, expected_size, archive)
        temp_output = Path(directory) / "ffmpeg.exe"
        _extract_ffmpeg(archive, temp_output)
        assert_target_binary_architecture(temp_output, target_triple)
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(temp_output, output)

    assert_target_binary_architecture(output, target_triple)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare a verified native FFmpeg binary for Ensemblis packaging")
    parser.add_argument("--target-triple", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(prepare(args.target_triple, args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
