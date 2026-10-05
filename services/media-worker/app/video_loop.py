from __future__ import annotations

from pathlib import Path


def looped_video_input_args(source: Path) -> tuple[str, ...]:
    """Return the canonical FFmpeg args for an indefinitely repeating visual source."""
    return ("-stream_loop", "-1", "-i", str(source))
