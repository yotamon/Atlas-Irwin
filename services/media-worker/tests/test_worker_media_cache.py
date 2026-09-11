from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

from app.media_cache import cacheable_supabase_audio, cached_download, prune_media_cache


SUPABASE_AUDIO_URL = (
    "https://example.supabase.co/storage/v1/object/public/public-media/"
    "owner/library/immutable-stem.wav"
)


class MediaCacheTest(unittest.TestCase):
    def test_only_public_supabase_audio_is_cacheable(self) -> None:
        self.assertTrue(cacheable_supabase_audio(SUPABASE_AUDIO_URL))
        self.assertFalse(cacheable_supabase_audio(
            "https://example.supabase.co/storage/v1/object/public/public-media/owner/library/video.mp4"
        ))
        self.assertFalse(cacheable_supabase_audio(
            "https://example.supabase.co/storage/v1/object/sign/private-media/owner/library/stem.wav"
        ))
        self.assertFalse(cacheable_supabase_audio(
            "https://cdn.example.com/storage/v1/object/public/public-media/owner/library/stem.wav"
        ))

    def test_cached_download_reuses_immutable_audio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache_root = root / "cache"
            calls: list[str] = []

            async def fake_download(url: str, target: Path, limit_bytes: int) -> None:
                calls.append(url)
                target.write_bytes(b"audio-payload")

            first = root / "first.wav"
            second = root / "second.wav"
            asyncio.run(cached_download(
                SUPABASE_AUDIO_URL,
                first,
                600 * 1024 * 1024,
                downloader=fake_download,
                root=cache_root,
            ))
            asyncio.run(cached_download(
                SUPABASE_AUDIO_URL,
                second,
                600 * 1024 * 1024,
                downloader=fake_download,
                root=cache_root,
            ))

            self.assertEqual(first.read_bytes(), b"audio-payload")
            self.assertEqual(second.read_bytes(), b"audio-payload")
            self.assertEqual(calls, [SUPABASE_AUDIO_URL])
            self.assertEqual(len(list(cache_root.glob("*.wav"))), 1)

    def test_cache_pruning_keeps_budget(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache_root = Path(directory)
            older = cache_root / "older.wav"
            protected = cache_root / "protected.wav"
            older.write_bytes(b"123456")
            protected.write_bytes(b"abcdef")

            prune_media_cache(cache_root, protected, max_bytes=10)

            self.assertFalse(older.exists())
            self.assertTrue(protected.exists())


if __name__ == "__main__":
    unittest.main()
