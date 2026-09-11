from __future__ import annotations

import asyncio
from pathlib import Path

from app import runner


SUPABASE_AUDIO_URL = (
    "https://example.supabase.co/storage/v1/object/public/public-media/"
    "owner/library/immutable-stem.wav"
)


def test_only_public_supabase_audio_is_cacheable() -> None:
    assert runner._cacheable_supabase_audio(SUPABASE_AUDIO_URL)
    assert not runner._cacheable_supabase_audio(
        "https://example.supabase.co/storage/v1/object/public/public-media/owner/library/video.mp4"
    )
    assert not runner._cacheable_supabase_audio(
        "https://example.supabase.co/storage/v1/object/sign/private-media/owner/library/stem.wav"
    )
    assert not runner._cacheable_supabase_audio(
        "https://cdn.example.com/storage/v1/object/public/public-media/owner/library/stem.wav"
    )


def test_cached_download_reuses_immutable_audio(tmp_path: Path, monkeypatch) -> None:
    cache_root = tmp_path / "cache"
    calls: list[str] = []

    async def fake_download(url: str, target: Path, limit_bytes: int = 600 * 1024 * 1024) -> None:
        calls.append(url)
        target.write_bytes(b"audio-payload")

    monkeypatch.setattr(runner, "_media_cache_root", lambda: cache_root)
    monkeypatch.setattr(runner, "_uncached_download", fake_download)

    first = tmp_path / "first.wav"
    second = tmp_path / "second.wav"
    asyncio.run(runner._cached_download(SUPABASE_AUDIO_URL, first))
    asyncio.run(runner._cached_download(SUPABASE_AUDIO_URL, second))

    assert first.read_bytes() == b"audio-payload"
    assert second.read_bytes() == b"audio-payload"
    assert calls == [SUPABASE_AUDIO_URL]
    assert len(list(cache_root.glob("*.wav"))) == 1


def test_cache_pruning_keeps_budget(tmp_path: Path, monkeypatch) -> None:
    cache_root = tmp_path / "cache"
    cache_root.mkdir()
    monkeypatch.setattr(runner, "_MEDIA_CACHE_MAX_BYTES", 10)

    older = cache_root / "older.wav"
    protected = cache_root / "protected.wav"
    older.write_bytes(b"123456")
    protected.write_bytes(b"abcdef")

    runner._prune_media_cache(cache_root, protected)

    assert not older.exists()
    assert protected.exists()
