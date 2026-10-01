from __future__ import annotations

import unittest

from app.mastering_dynamics import build_dynamics_plan


def _source(
    *,
    plr: float = 13.0,
    crest: float = 12.0,
    psr: float = 11.0,
    rms: float = -18.0,
    transient_crest: float = 11.0,
    bpm: float = 120.0,
) -> dict:
    return {
        "dynamics": {
            "peak_to_loudness_ratio_lu": plr,
            "crest_factor_db": crest,
            "psr_median_lu": psr,
            "short_term_rms_median_dbfs": rms,
        },
        "transients": {
            "transient_crest_p90_db": transient_crest,
        },
        "reference_signature": {
            "tempo_median_bpm": bpm,
        },
    }


def _target(max_gr: float = 2.5) -> dict:
    return {
        "change_budget": {
            "max_limiter_gain_reduction_db": max_gr,
        }
    }


class MasteringDynamicsV2Test(unittest.TestCase):
    def test_dynamic_intent_never_adds_bus_compression(self) -> None:
        result = build_dynamics_plan("dynamic", _source(), _target())
        self.assertFalse(result["enabled"])
        self.assertEqual(result["reason"], "intent_preserves_dynamics")

    def test_dense_source_bypasses_compression(self) -> None:
        result = build_dynamics_plan(
            "punchy",
            _source(plr=7.5, crest=6.2, psr=6.0),
            _target(),
        )
        self.assertFalse(result["enabled"])
        self.assertEqual(result["reason"], "source_already_dynamically_constrained")

    def test_transient_rich_source_gets_slower_attack(self) -> None:
        soft = build_dynamics_plan(
            "balanced",
            _source(transient_crest=7.0),
            _target(),
        )
        punchy = build_dynamics_plan(
            "balanced",
            _source(transient_crest=14.0),
            _target(),
        )
        self.assertTrue(soft["enabled"])
        self.assertTrue(punchy["enabled"])
        self.assertGreater(float(punchy["attack_ms"]), float(soft["attack_ms"]))

    def test_release_follows_tempo_with_bounds(self) -> None:
        fast = build_dynamics_plan("balanced", _source(bpm=160.0), _target())
        slow = build_dynamics_plan("balanced", _source(bpm=80.0), _target())
        self.assertLess(float(fast["release_ms"]), float(slow["release_ms"]))
        self.assertGreaterEqual(float(fast["release_ms"]), 85.0)
        self.assertLessEqual(float(slow["release_ms"]), 280.0)


if __name__ == "__main__":
    unittest.main()
