from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
from collections.abc import Awaitable, Callable
from pathlib import Path
from urllib.parse import urlparse

MEDIA_CACHE_MAX_BYTES = 512 * 1024 * 1024
CACHEABLE_AUDIO_SUFFIXES = frozenset({".aac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav"})
DownloadFn = Callable[[str, Path, int], Awaitable[None]]


def media_cache_root() -> Path | None:
    configured = os.environ.get("ENSEMBLIS_MEDIA_CACHE_DIR", "").strip()
    if configured:
        return Path(configured)

    # Vercel Sandbox dispatches jobs from the persistent worker directory. Keep
    # local executions uncached unless a cache directory is explicitly set.
    cwd = Path.cwd()
    if cwd.name == "atlas-media-worker":
        return cwd / ".media-cache"
    return None


def cacheable_supabase_audio(url: str) -> bool:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or not hostname.endswith(".supabase.co"):
        return False
    if "/storage/v1/object/public/public-media/" not in parsed.path:
        return False
    return Path(parsed.path).suffix.lower() in CACHEABLE_AUDIO_SUFFIXES


def cache_path(root: Path, url: str) -> Path:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
    suffix = Path(urlparse(url).path).suffix.lower()
    return root / f"{digest}{suffix}"


def valid_cached_file(path: Path, limit_bytes: int) -> bool:
    try:
        size = path.stat().st_size
    except FileNotFoundError:
        return False
    if size <= 0 or size > limit_bytes:
        path.unlink(missing_ok=True)
        return False
    return True


def prune_media_cache(root: Path, protected: Path, max_bytes: int = MEDIA_CACHE_MAX_BYTES) -> None:
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


async def cached_download(
    url: str,
    target: Path,
    limit_bytes: int,
    *,
    downloader: DownloadFn,
    root: Path | None = None,
) -> None:
    cache_root = media_cache_root() if root is None else root
    if cache_root is None or not cacheable_supabase_audio(url):
        await downloader(url, target, limit_bytes)
        return

    cache_root.mkdir(parents=True, exist_ok=True)
    cached = cache_path(cache_root, url)
    if valid_cached_file(cached, limit_bytes):
        await asyncio.to_thread(shutil.copyfile, cached, target)
        cached.touch()
        return

    staging = cached.with_name(f"{cached.name}.part")
    staging.unlink(missing_ok=True)
    try:
        await downloader(url, staging, limit_bytes)
        if not valid_cached_file(staging, limit_bytes):
            raise RuntimeError("Media Worker downloaded an empty cache entry")
        staging.replace(cached)
        await asyncio.to_thread(shutil.copyfile, cached, target)
        cached.touch()
        await asyncio.to_thread(prune_media_cache, cache_root, cached)
    finally:
        staging.unlink(missing_ok=True)
