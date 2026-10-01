from __future__ import annotations

import unittest

from app.mastering_stereo import build_stereo_plan


def _source(
    *,
    channels: int = 2,
    low_side: float = 0.25,
    correlation: float = 0.7,
    mono_delta: float = -0.4,
    issues: list[dict] | None = None,
) -> dict:
    return {
        "format": {"channels": channels},
        "stereo": {
            "correlation": correlation,
            "mono_fold_down_delta_db": mono_delta,
            "band_side_share": {
                "sub_20_80": low_side,
                "bass_80_180": low_side,
            },
        },
        "issues": issues or [],
    }


class MasteringStereoV2Test(unittest.TestCase):
    def test_healthy_stereo_is_preserved(self) -> None:
        result = build_stereo_plan("balanced", _source(), {})
        self.assertFalse(result["enabled"])
        self.assertEqual(result["mode"], "preserve")
        self.assertFalse(result["blind_widening_allowed"])

    def test_streaming_safe_never_changes_stereo(self) -> None:
        result = build_stereo_plan(
            "streaming_safe",
            _source(low_side=0.7, mono_delta=-2.5),
            {},
        )
        self.assertFalse(result["enabled"])
        self.assertEqual(float(result["side_level"]), 1.0)

    def test_wide_low_end_can_trigger_gentle_side_trim(self) -> None:
        result = build_stereo_plan(
            "balanced",
            _source(low_side=0.56, mono_delta=-2.0),
            {},
        )
        self.assertTrue(result["enabled"])
        self.assertEqual(result["mode"], "corrective_side_trim")
        self.assertLess(float(result["side_level"]), 1.0)
        self.assertGreaterEqual(float(result["side_level"]), 0.88)

    def test_severe_phase_risk_is_not_hidden_by_mastering(self) -> None:
        result = build_stereo_plan(
            "punchy",
            _source(
                low_side=0.7,
                correlation=-0.35,
                mono_delta=-4.0,
                issues=[{"code": "phase_risk", "severity": "review"}],
            ),
            {},
        )
        self.assertFalse(result["enabled"])
        self.assertEqual(result["reason"], "severe_phase_risk_requires_source_or_mix_review")

    def test_mono_source_never_enters_stereo_tools(self) -> None:
        result = build_stereo_plan("balanced", _source(channels=1, low_side=0.8), {})
        self.assertFalse(result["enabled"])
        self.assertEqual(result["reason"], "corrective_stereo_requires_stereo_source")


if __name__ == "__main__":
    unittest.main()
