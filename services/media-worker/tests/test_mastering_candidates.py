from __future__ import annotations

import unittest

from app.mastering_candidates import build_candidate_family, candidate_sort_key, select_candidate


def _target() -> dict:
    return {
        "integrated_lufs": -10.0,
        "true_peak_dbtp": -1.2,
        "preserve_source": False,
        "loudness_range": {
            "preferred_lufs": -10.0,
            "min_lufs": -11.25,
            "max_lufs": -9.65,
        },
        "true_peak": {"ceiling_dbtp": -1.2},
    }


def _candidate(
    *,
    candidate_id: str,
    technical: bool,
    creative: bool,
    loudness: float,
    limiter_gr: float,
    damage_value: float,
) -> dict:
    return {
        "id": candidate_id,
        "role": candidate_id,
        "target": _target(),
        "after": {"loudness": {"integrated_lufs": loudness}},
        "measurement": {"estimated_peak_gain_reduction_db": limiter_gr},
        "checks": {
            "technical_pass": technical,
            "creative_pass": creative,
            "pass": technical and creative,
            "change_budget": {
                "checks": [
                    {
                        "metric": "plr_loss_lu",
                        "status": "pass" if damage_value <= 1.0 else "fail",
                        "value": damage_value,
                        "maximum": 1.0,
                    }
                ]
            },
        },
    }


class MasteringCandidateOptimizerV2Test(unittest.TestCase):
    def test_creative_family_contains_cleaner_loudness_options(self) -> None:
        family = build_candidate_family(_target())
        self.assertEqual([item["id"] for item in family], [
            "target_centered",
            "more_dynamic",
            "conservative",
        ])
        preferred = float(family[0]["target"]["integrated_lufs"])
        self.assertLess(float(family[1]["target"]["integrated_lufs"]), preferred)
        self.assertLess(float(family[2]["target"]["integrated_lufs"]), float(family[1]["target"]["integrated_lufs"]))

    def test_full_pass_beats_louder_damaged_candidate(self) -> None:
        damaged = _candidate(
            candidate_id="louder_damaged",
            technical=True,
            creative=False,
            loudness=-9.9,
            limiter_gr=4.0,
            damage_value=1.6,
        )
        clean = _candidate(
            candidate_id="cleaner",
            technical=True,
            creative=True,
            loudness=-10.6,
            limiter_gr=1.2,
            damage_value=0.6,
        )
        result = select_candidate([damaged, clean])
        self.assertEqual(result["selected_id"], "cleaner")

    def test_lower_damage_breaks_tie_between_passing_candidates(self) -> None:
        first = _candidate(
            candidate_id="first",
            technical=True,
            creative=True,
            loudness=-10.1,
            limiter_gr=2.0,
            damage_value=0.8,
        )
        second = _candidate(
            candidate_id="second",
            technical=True,
            creative=True,
            loudness=-10.4,
            limiter_gr=1.0,
            damage_value=0.3,
        )
        self.assertLess(candidate_sort_key(second), candidate_sort_key(first))
        result = select_candidate([first, second])
        self.assertEqual(result["selected_id"], "second")

    def test_technically_valid_review_candidate_beats_invalid_candidate(self) -> None:
        review = _candidate(
            candidate_id="review",
            technical=True,
            creative=False,
            loudness=-10.0,
            limiter_gr=3.0,
            damage_value=1.4,
        )
        invalid = _candidate(
            candidate_id="invalid",
            technical=False,
            creative=False,
            loudness=-10.0,
            limiter_gr=0.0,
            damage_value=0.1,
        )
        result = select_candidate([invalid, review])
        self.assertEqual(result["selected_id"], "review")
        self.assertIn("review", result["rationale"].lower())


if __name__ == "__main__":
    unittest.main()
