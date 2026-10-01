from __future__ import annotations

import unittest

from app.mastering_references import (
    score_reference_similarity,
    select_references,
    weighted_reference_bands,
    weighted_reference_value,
)


def _signature(
    *,
    lufs: float = -10.0,
    plr: float = 11.0,
    crest: float = 10.5,
    corr: float = 0.65,
    bpm: float = 120.0,
    onset: float = 1.2,
    shift: float = 0.0,
) -> dict:
    return {
        "integrated_lufs": lufs,
        "peak_to_loudness_ratio_lu": plr,
        "crest_factor_db": crest,
        "stereo_correlation": corr,
        "tempo_median_bpm": bpm,
        "onset_density_per_second": onset,
        "perceptual_envelope_db": {
            "sub_20_40": -24.0 + shift,
            "sub_40_80": -15.0 + shift,
            "bass_80_160": -8.0 + shift,
            "bass_160_315": -8.5 + shift,
            "low_mid_315_630": -10.0 + shift,
            "mid_630_1250": -9.0 + shift,
            "upper_mid_1250_2500": -10.0 + shift,
            "presence_2500_4000": -12.0 + shift,
            "presence_4000_6000": -14.0 + shift,
            "air_6000_10000": -17.0 + shift,
            "air_10000_16000": -22.0 + shift,
            "ultra_16000_20000": -30.0 + shift,
        },
        "band_relative_db": {
            "sub_20_80": -18.0 + shift,
            "bass_80_180": -9.0 + shift,
            "low_mid_180_500": -9.5 + shift,
            "mid_500_2500": -6.0 + shift,
            "presence_2500_6000": -11.0 + shift,
            "air_6000_16000": -17.0 + shift,
        },
        "section_signatures": [
            {
                "label": "verse",
                "perceptual_envelope_db": {
                    "bass_80_160": -8.5 + shift,
                    "mid_630_1250": -9.5 + shift,
                    "air_6000_10000": -18.0 + shift,
                },
            },
            {
                "label": "chorus",
                "perceptual_envelope_db": {
                    "bass_80_160": -7.5 + shift,
                    "mid_630_1250": -8.5 + shift,
                    "air_6000_10000": -16.0 + shift,
                },
            },
        ],
    }


class MasteringReferenceIntelligenceV2Test(unittest.TestCase):
    def test_similar_reference_scores_above_dissimilar_reference(self) -> None:
        source = _signature()
        similar = _signature(shift=0.2, bpm=121.0, plr=11.4)
        different = _signature(shift=5.0, bpm=87.0, plr=5.0, crest=5.5, corr=0.1)
        similar_score = score_reference_similarity(source, similar)
        different_score = score_reference_similarity(source, different)

        self.assertGreater(float(similar_score["similarity"]), float(different_score["similarity"]))
        self.assertGreaterEqual(int(similar_score["matched_section_count"]), 2)

    def test_selection_requires_three_confident_trusted_references(self) -> None:
        source = _signature()
        two = [_signature(shift=0.1), _signature(shift=0.3)]
        selection = select_references(source, two)
        self.assertFalse(selection["automatic_influence"])
        self.assertEqual(selection["selected_count"], 0)

        three = two + [_signature(shift=-0.2)]
        selection = select_references(source, three)
        self.assertTrue(selection["automatic_influence"])
        self.assertEqual(selection["selected_count"], 3)
        self.assertGreater(float(selection["influence_confidence"]), 0.5)

    def test_dissimilar_references_do_not_gain_automatic_influence(self) -> None:
        source = _signature()
        refs = [
            _signature(shift=7.0, bpm=80.0, plr=5.0, corr=0.0),
            _signature(shift=-7.0, bpm=170.0, plr=17.0, corr=-0.2),
            _signature(shift=6.0, bpm=92.0, plr=4.5, corr=0.1),
        ]
        selection = select_references(source, refs)
        self.assertFalse(selection["automatic_influence"])

    def test_v2_source_can_still_use_legacy_six_band_references(self) -> None:
        source = _signature()
        refs = []
        for shift in (0.1, -0.2, 0.3):
            item = _signature(shift=shift)
            item.pop("perceptual_envelope_db", None)
            item.pop("section_signatures", None)
            item.pop("onset_density_per_second", None)
            refs.append(item)

        selection = select_references(source, refs)
        self.assertTrue(selection["automatic_influence"])
        self.assertEqual(selection["selected_count"], 3)
        self.assertTrue(all(row["spectral_resolution"] == "legacy" for row in selection["ranked"]))

    def test_weighted_reference_values_favor_more_similar_reference(self) -> None:
        source = _signature()
        close = _signature(lufs=-10.0, shift=0.1)
        medium = _signature(lufs=-11.0, shift=1.0)
        far = _signature(lufs=-13.0, shift=2.0)
        selection = select_references(source, [far, medium, close])
        self.assertTrue(selection["automatic_influence"])

        lufs = weighted_reference_value(selection, "integrated_lufs")
        self.assertIsNotNone(lufs)
        self.assertGreater(float(lufs), -12.0)
        bands = weighted_reference_bands(selection, "band_relative_db")
        self.assertIn("bass_80_180", bands)


if __name__ == "__main__":
    unittest.main()
