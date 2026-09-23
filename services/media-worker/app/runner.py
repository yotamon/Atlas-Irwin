from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from . import main as worker_main
from .automix import AutomixWorkerRequest, execute_automix
from .automix_preview import AutomixPreviewWorkerRequest, execute_automix_preview
from .mastering_processor import MasteringWorkerRequest, execute_mastering
from .music_intelligence_v4_runtime import analyze_music as analyze_music_v4
from .social_finishing import SocialWorkerRequest, execute_social
from .stem_intelligence_v3 import analyze_stem as analyze_stem_v3

# Keep the stable analyzers importable for rollback, but route production Sandbox
# entrypoints through the new post-processing layers.
worker_main.analyze_music = analyze_music_v4
worker_main.analyze_stem = analyze_stem_v3

_MEDIA_CACHE_MAX_BYTES = 512 * 1024 * 1024
_CACHEABLE_AUDIO_SUFFIXES = frozenset({".aac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav"})
_uncached_download = worker_main.download


def _media_cache_root() -> Path | None:
    configured = os.environ.get("ENSEMBLIS_MEDIA_CACHE_DIR", "").strip()
    if configured:
        return Path(configured)

    # Vercel Sandbox dispatches jobs from the persistent worker directory. Keep
    # local/test executions ephemeral unless a cache directory is explicitly set.
    cwd = Path.cwd()
    if cwd.name == "atlas-media-worker":
        return cwd / ".media-cache"
    return None


def _cacheable_supabase_audio(url: str) -> bool:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or not hostname.endswith(".supabase.co"):
        return False
    if "/storage/v1/object/public/public-media/" not in parsed.path:
        return False
    return Path(parsed.path).suffix.lower() in _CACHEABLE_AUDIO_SUFFIXES


def _cache_path(root: Path, url: str) -> Path:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
    suffix = Path(urlparse(url).path).suffix.lower()
    return root / f"{digest}{suffix}"


def _valid_cached_file(path: Path, limit_bytes: int) -> bool:
    try:
        size = path.stat().st_size
    except FileNotFoundError:
        return False
    if size <= 0 or size > limit_bytes:
        path.unlink(missing_ok=True)
        return False
    return True


def _prune_media_cache(root: Path, protected: Path, max_bytes: int = _MEDIA_CACHE_MAX_BYTES) -> None:
    files: list[tuple[float, int, Path]] = []
    total = 0
    for path in root.iterdir():
        if not path.is_file() or path.name.endswith(".part"):
            continue
        try:
            stat = path.stat()
        except FileNotFoundError:
            continue
        total += stat.st_size
        files.append((stat.st_mtime, stat.st_size, path))

    if total <= max_bytes:
        return

    for _, size, path in sorted(files, key=lambda item: item[0]):
        if total <= max_bytes:
            break
        if path == protected:
            continue
        path.unlink(missing_ok=True)
        total -= size

    # A single unusually large source should never make the persistent cache
    # exceed its budget. The current job already has its working copy.
    if total > max_bytes and protected.exists():
        protected.unlink(missing_ok=True)


async def _cached_download(url: str, target: Path, limit_bytes: int = 600 * 1024 * 1024) -> None:
    root = _media_cache_root()
    if root is None or not _cacheable_supabase_audio(url):
        await _uncached_download(url, target, limit_bytes)
        return

    root.mkdir(parents=True, exist_ok=True)
    cached = _cache_path(root, url)
    if _valid_cached_file(cached, limit_bytes):
        await asyncio.to_thread(shutil.copyfile, cached, target)
        cached.touch()
        return

    staging = cached.with_name(f"{cached.name}.part")
    staging.unlink(missing_ok=True)
    try:
        await _uncached_download(url, staging, limit_bytes)
        if not _valid_cached_file(staging, limit_bytes):
            raise RuntimeError("Media Worker downloaded an empty cache entry")
        staging.replace(cached)
        await asyncio.to_thread(shutil.copyfile, cached, target)
        cached.touch()
        await asyncio.to_thread(_prune_media_cache, root, cached)
    finally:
        staging.unlink(missing_ok=True)


# All download calls inside worker_main resolve this global at execution time.
# Reusing immutable UUID-based public-media objects prevents every stem-analysis
# and Audio Scene job from re-downloading the same heavy WAVs from Supabase.
worker_main.download = _cached_download

WorkerRequest = worker_main.WorkerRequest
execute = worker_main.execute

LOCK_PATH = Path("/tmp/atlas-media-worker.lock")
CONTRACT_VERSION = 1
CONTRACT_PAYLOAD_KEY = "__ensemblis_media_worker_contract_version"
CONTRACT_JOB_TYPES = frozenset({
    "analyze_audio",
    "analyze_stem",
    "extract_frame",
    "render_master",
    "render_social",
    "render_promo",
    "render_hook",
    "render_audio_scene",
    "master_audio",
    "finish_social_video",
    "render_automix",
    "render_automix_preview",
})


def validate_request_envelope(value: dict[str, Any]) -> None:
    job_type = value.get("job_type")
    if job_type not in CONTRACT_JOB_TYPES:
        raise ValueError(f"Unsupported Media Worker job type: {job_type!r}")
    payload = value.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("Media Worker payload must be an object")
    version = payload.get(CONTRACT_PAYLOAD_KEY)
    if version != CONTRACT_VERSION:
        raise ValueError(
            f"Unsupported Media Worker contract version: {version!r}; expected {CONTRACT_VERSION}"
        )


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m app.runner <request-json>")

    request_path = Path(sys.argv[1])
    try:
        raw = request_path.read_text(encoding="utf-8")
        payload = json.loads(raw)
        validate_request_envelope(payload)
        if payload.get("job_type") == "finish_social_video":
            request = SocialWorkerRequest.model_validate(payload)
            executor = execute_social
        elif payload.get("job_type") == "master_audio":
            request = MasteringWorkerRequest.model_validate(payload)
            executor = execute_mastering
        elif payload.get("job_type") == "render_automix":
            request = AutomixWorkerRequest.model_validate(payload)
            executor = execute_automix
        elif payload.get("job_type") == "render_automix_preview":
            request = AutomixPreviewWorkerRequest.model_validate(payload)
            executor = execute_automix_preview
        else:
            request = WorkerRequest.model_validate(payload)
            executor = execute
    finally:
        # The raw one-time callback token must never survive into a persistent Sandbox snapshot.
        request_path.unlink(missing_ok=True)

    try:
        asyncio.run(executor(request))
    finally:
        shutil.rmtree(LOCK_PATH, ignore_errors=True)


if __name__ == "__main__":
    main()
