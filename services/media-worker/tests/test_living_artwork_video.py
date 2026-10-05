import numpy as np

from app.loop_video import _boundary_metrics_arrays
from app.loop_visualizer import _duration_from_probe_text


def test_identical_boundary_is_ready() -> None:
    first = np.full((32, 32, 3), 96, dtype=np.uint8)
    last = np.full((32, 32, 3), 96, dtype=np.uint8)

    result = _boundary_metrics_arrays(first, last)

    assert result["state"] == "ready"
    assert result["similarity"] == 1.0
    assert result["luminance_delta"] == 0.0


def test_large_boundary_jump_is_blocked() -> None:
    first = np.zeros((32, 32, 3), dtype=np.uint8)
    last = np.full((32, 32, 3), 255, dtype=np.uint8)

    result = _boundary_metrics_arrays(first, last)

    assert result["state"] == "blocked"
    assert result["similarity"] == 0.0
    assert result["luminance_delta"] == 1.0


def test_near_boundary_is_repairable() -> None:
    first = np.full((32, 32, 3), 100, dtype=np.uint8)
    last = np.full((32, 32, 3), 132, dtype=np.uint8)

    result = _boundary_metrics_arrays(first, last)

    assert result["state"] == "repair_available"
    assert 0.8 <= result["similarity"] < 0.92
    assert 0.0 < result["color_delta"] <= 0.14


def test_visualizer_probe_parses_canonical_media_duration() -> None:
    text = "Duration: 00:03:12.340, start: 0.000000, bitrate: 320 kb/s"
    assert _duration_from_probe_text(text) == 192.34
