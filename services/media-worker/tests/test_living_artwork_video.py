import numpy as np

from app.loop_video import _boundary_metrics_arrays


def test_identical_boundary_is_ready() -> None:
    first = np.full((32, 32, 3), 96, dtype=np.uint8)
    last = np.full((32, 32, 3), 96, dtype=np.uint8)

    result = _boundary_metrics_arrays(first, last)

    assert result["state"] == "ready"
    assert result["similarity"] == 1.0
    assert result["luminance_delta"] == 0.0


def test_large_boundary_jump_needs_review() -> None:
    first = np.zeros((32, 32, 3), dtype=np.uint8)
    last = np.full((32, 32, 3), 255, dtype=np.uint8)

    result = _boundary_metrics_arrays(first, last)

    assert result["state"] == "needs_review"
    assert result["similarity"] == 0.0
    assert result["luminance_delta"] == 1.0
