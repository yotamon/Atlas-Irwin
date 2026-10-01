from __future__ import annotations

import sys
import types
import unittest
from unittest.mock import patch

import httpx

fake_music = types.ModuleType("app.music_intelligence")
fake_music.analyze_music = lambda *_args, **_kwargs: {}
fake_stem = types.ModuleType("app.stem_intelligence")
fake_stem.analyze_stem = lambda *_args, **_kwargs: {}
fake_video = types.ModuleType("app.video_director_finishing")
fake_video.build_video_director_filter = lambda *_args, **_kwargs: ""
fake_video.extract_review_frames = lambda *_args, **_kwargs: []

with patch.dict(
    sys.modules,
    {
        "app.music_intelligence": fake_music,
        "app.stem_intelligence": fake_stem,
        "app.video_director_finishing": fake_video,
    },
):
    from app.main import raise_upload_error


class UploadErrorTest(unittest.TestCase):
    def test_signed_upload_error_keeps_reason_but_never_url_or_token(self) -> None:
        request = httpx.Request(
            "PUT",
            "https://example.supabase.co/storage/v1/object/upload/sign/public-media/master.flac?token=super-secret",
        )
        response = httpx.Response(
            400,
            request=request,
            json={
                "httpStatusCode": 413,
                "userStatusCode": 400,
                "code": "EntityTooLarge",
                "error": "Payload too large",
            },
        )

        with self.assertRaises(RuntimeError) as caught:
            raise_upload_error(response)

        message = str(caught.exception)
        self.assertIn("Media upload failed (400)", message)
        self.assertIn("EntityTooLarge", message)
        self.assertIn("Payload too large", message)
        self.assertNotIn("super-secret", message)
        self.assertNotIn("storage/v1/object/upload/sign", message)

    def test_success_response_does_not_raise(self) -> None:
        response = httpx.Response(200, request=httpx.Request("PUT", "https://example.com/upload"))
        self.assertIsNone(raise_upload_error(response))


if __name__ == "__main__":
    unittest.main()
