from pathlib import Path

from PIL import Image

from app.loop_video import _boundary_metrics


def _image(path: Path, value: int) -> Path:
    Image.new("RGB", (32, 32), (value, value, value)).save(path)
    return path


def test_identical_boundary_is_ready(tmp_path: Path) -> None:
    first = _image(tmp_path / "first.png", 96)
    last = _image(tmp_path / "last.png", 96)

    result = _boundary_metrics(first, last)

    assert result["state"] == "ready"
    assert result["similarity"] == 1.0
    assert result["luminance_delta"] == 0.0


def test_large_boundary_jump_needs_review(tmp_path: Path) -> None:
    first = _image(tmp_path / "first.png", 0)
    last = _image(tmp_path / "last.png", 255)

    result = _boundary_metrics(first, last)

    assert result["state"] == "needs_review"
    assert result["similarity"] == 0.0
    assert result["luminance_delta"] == 1.0
