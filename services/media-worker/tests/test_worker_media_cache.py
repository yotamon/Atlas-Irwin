from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

# The cache lives in runner.py because runner.py is already part of the persistent
# Sandbox bootstrap. Social finishing is irrelevant to this unit and Pillow is
# intentionally not installed by the deterministic DSP test profile.
fake_social = types.ModuleType("app.social_finishing")
fake_social.SocialWorkerRequest = type("SocialWorkerRequest", (), {})


async def _unused_execute_social(*_args, **_kwargs):
    raise AssertionError("social finishing should not run in media cache tests")


fake_social.execute_social = _unused_execute_social
sys.modules.setdefault("app.social_finishing", fake_social)

from app import runner  # noqa: E402


SUPABASE_AUDIO_URL = (
    "https://example.supabase.co/storage/v1/object/public/public-media/"
    "owner/library/immutable-stem.wav"
)


class MediaCacheTest(unittest.TestCase):
    def test_only_public_supabase_audio_is_cacheable(self) -> None:
        self.assertTrue(runner._cacheable_supabase_audio(SUPABASE_AUDIO_URL))
        self.assertFalse(runner._cacheable_supabase_audio(
            "https://example.supabase.co/storage/v1/object/public/public-media/owner/library/video.mp4"
        ))
        self.assertFalse(runner._cacheable_supabase_audio(
            "https://example.supabase.co/storage/v1/object/sign/private-media/owner/library/stem.wav"
        ))
        self.assertFalse(runner._cacheable_supabase_audio(
            "https://cdn.example.com/storage/v1/object/public/public-media/owner/library/stem.wav"
        ))

    def test_cached_download_reuses_immutable_audio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache_root = root / "cache"
            calls: list[str] = []

            async def fake_download(url: str, target: Path, limit_bytes: int = 600 * 1024 * 1024) -> None:
                calls.append(url)
                target.write_bytes(b"audio-payload")

            first = root / "first.wav"
            second = root / "second.wav"
            with patch.dict(os.environ, {"ENSEMBLIS_MEDIA_CACHE_DIR": str(cache_root)}), patch.object(
                runner, "_uncached_download", fake_download
            ):
                asyncio.run(runner._cached_download(SUPABASE_AUDIO_URL, first))
                asyncio.run(runner._cached_download(SUPABASE_AUDIO_URL, second))

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

            runner._prune_media_cache(cache_root, protected, max_bytes=10)

            self.assertFalse(older.exists())
            self.assertTrue(protected.exists())


if __name__ == "__main__":
    unittest.main()
