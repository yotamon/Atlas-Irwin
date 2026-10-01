from __future__ import annotations

import math
from statistics import median
from typing import Any

REFERENCE_INTELLIGENCE_SCHEMA = "ensemblis.mastering_references.v2"
_MIN_AUTOMATIC_REFERENCES = 3
_MIN_INFLUENCE_CONFIDENCE = 0.52
_MAX_SELECTED_REFERENCES = 5


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _normalized_label(value: Any) -> str:
    label = str(value or "").strip().lower()
    aliases = {
        "hook": "chorus",
        "refrain": "chorus",
        "drop": "chorus",
        "prechorus": "pre_chorus",
        "pre-chorus": "pre_chorus",
        "intro": "intro",
        "outro": "outro",
        "verse": "verse",
        "chorus": "chorus",
        "bridge": "bridge",
        "breakdown": "breakdown",
    }
    compact = label.replace(" ", "_")
    return aliases.get(label, aliases.get(compact, compact))


def _vector_distance(
    left: dict[str, Any],
    right: dict[str, Any],
    *,
    scale_db: float = 6.0,
) -> tuple[float | None, int]:
    shared = sorted(set(left) & set(right))
    deltas: list[float] = []
    for key in shared:
        a = _number(left.get(key))
        b = _number(right.get(key))
        if a is None or b is None:
            continue
        deltas.append(abs(a - b))
    if not deltas:
        return None, 0
    mean_delta = sum(deltas) / len(deltas)
    return _clamp(mean_delta / max(scale_db, 1e-6), 0.0, 1.0), len(deltas)


def _scalar_similarity(
    source: Any,
    reference: Any,
    *,
    scale: float,
) -> float | None:
    left = _number(source)
    right = _number(reference)
    if left is None or right is None:
        return None
    return 1.0 - _clamp(abs(left - right) / max(scale, 1e-6), 0.0, 1.0)


def _tempo_similarity(source: Any, reference: Any) -> float | None:
    left = _number(source)
    right = _number(reference)
    if left is None or right is None or left <= 0 or right <= 0:
        return None
    ratio = max(left, right) / min(left, right)
    # Treat common half/double-time representations as equivalent.
    ratio = min(ratio, abs(ratio - 2.0) + 1.0)
    return 1.0 - _clamp(abs(math.log2(ratio)) / 0.35, 0.0, 1.0)


def _section_similarity(
    source_signature: dict[str, Any],
    reference_signature: dict[str, Any],
) -> tuple[float | None, int]:
    source_sections = [
        item for item in _list(source_signature.get("section_signatures"))
        if isinstance(item, dict)
    ]
    reference_sections = [
        item for item in _list(reference_signature.get("section_signatures"))
        if isinstance(item, dict)
    ]
    if not source_sections or not reference_sections:
        return None, 0

    reference_by_label: dict[str, list[dict[str, Any]]] = {}
    for item in reference_sections:
        label = _normalized_label(item.get("label"))
        if label:
            reference_by_label.setdefault(label, []).append(item)

    scores: list[float] = []
    for source in source_sections:
        label = _normalized_label(source.get("label"))
        candidates = reference_by_label.get(label, [])
        if not candidates:
            continue
        source_envelope = (
            _record(source.get("perceptual_envelope_db"))
            or _record(source.get("band_relative_db"))
        )
        best: float | None = None
        for candidate in candidates:
            candidate_envelope = (
                _record(candidate.get("perceptual_envelope_db"))
                or _record(candidate.get("band_relative_db"))
            )
            distance, count = _vector_distance(source_envelope, candidate_envelope)
            if distance is None or count < 3:
                continue
            similarity = 1.0 - distance
            if best is None or similarity > best:
                best = similarity
        if best is not None:
            scores.append(best)

    if not scores:
        return None, 0
    return sum(scores) / len(scores), len(scores)


def score_reference_similarity(
    source_signature: dict[str, Any],
    reference_signature: dict[str, Any],
) -> dict[str, Any]:
    source_envelope = (
        _record(source_signature.get("perceptual_envelope_db"))
        or _record(source_signature.get("band_relative_db"))
    )
    reference_envelope = (
        _record(reference_signature.get("perceptual_envelope_db"))
        or _record(reference_signature.get("band_relative_db"))
    )
    spectral_distance, spectral_band_count = _vector_distance(
        source_envelope,
        reference_envelope,
    )
    spectral_similarity = (
        1.0 - spectral_distance if spectral_distance is not None else None
    )

    components: list[tuple[str, float | None, float]] = [
        ("spectral", spectral_similarity, 0.34),
        (
            "plr",
            _scalar_similarity(
                source_signature.get("peak_to_loudness_ratio_lu"),
                reference_signature.get("peak_to_loudness_ratio_lu"),
                scale=6.0,
            ),
            0.16,
        ),
        (
            "crest",
            _scalar_similarity(
                source_signature.get("crest_factor_db"),
                reference_signature.get("crest_factor_db"),
                scale=6.0,
            ),
            0.10,
        ),
        (
            "stereo",
            _scalar_similarity(
                source_signature.get("stereo_correlation"),
                reference_signature.get("stereo_correlation"),
                scale=0.75,
            ),
            0.08,
        ),
        (
            "transients",
            _scalar_similarity(
                source_signature.get("onset_density_per_second"),
                reference_signature.get("onset_density_per_second"),
                scale=2.5,
            ),
            0.10,
        ),
        (
            "tempo",
            _tempo_similarity(
                source_signature.get("tempo_median_bpm"),
                reference_signature.get("tempo_median_bpm"),
            ),
            0.08,
        ),
    ]
    section_similarity, matched_sections = _section_similarity(
        source_signature,
        reference_signature,
    )
    components.append(("sections", section_similarity, 0.14))

    available_weight = sum(weight for _, value, weight in components if value is not None)
    weighted = sum(
        float(value) * weight
        for _, value, weight in components
        if value is not None
    )
    similarity = weighted / available_weight if available_weight > 0 else 0.0
    evidence_ratio = available_weight / sum(weight for _, _, weight in components)
    confidence = _clamp(0.65 * evidence_ratio + 0.35 * similarity, 0.0, 1.0)

    return {
        "similarity": round(similarity, 4),
        "confidence": round(confidence, 4),
        "spectral_band_count": spectral_band_count,
        "matched_section_count": matched_sections,
        "components": {
            name: round(float(value), 4) if value is not None else None
            for name, value, _ in components
        },
    }


def select_references(
    source_signature: dict[str, Any],
    reference_signatures: list[dict[str, Any]],
) -> dict[str, Any]:
    ranked: list[dict[str, Any]] = []
    for index, signature in enumerate(reference_signatures):
        if not isinstance(signature, dict):
            continue
        score = score_reference_similarity(source_signature, signature)
        ranked.append({
            "index": index,
            "signature": signature,
            **score,
        })
    ranked.sort(
        key=lambda item: (
            float(item["similarity"]),
            float(item["confidence"]),
        ),
        reverse=True,
    )
    selected = ranked[:_MAX_SELECTED_REFERENCES]
    strong = [
        item for item in selected
        if float(item["confidence"]) >= _MIN_INFLUENCE_CONFIDENCE
    ]
    automatic = (
        len(reference_signatures) >= _MIN_AUTOMATIC_REFERENCES
        and len(strong) >= _MIN_AUTOMATIC_REFERENCES
    )
    if not automatic:
        strong = []

    influence_confidence = (
        float(median([float(item["confidence"]) for item in strong]))
        if strong
        else 0.0
    )
    return {
        "schema": REFERENCE_INTELLIGENCE_SCHEMA,
        "automatic_influence": automatic,
        "minimum_reference_count": _MIN_AUTOMATIC_REFERENCES,
        "available_count": len(reference_signatures),
        "selected_count": len(strong),
        "influence_confidence": round(influence_confidence, 4),
        "selected": strong,
        "ranked": [
            {
                "index": item["index"],
                "similarity": item["similarity"],
                "confidence": item["confidence"],
                "components": item["components"],
                "matched_section_count": item["matched_section_count"],
            }
            for item in ranked
        ],
    }


def weighted_reference_value(
    selection: dict[str, Any],
    key: str,
) -> float | None:
    pairs: list[tuple[float, float]] = []
    for item in _list(selection.get("selected")):
        if not isinstance(item, dict):
            continue
        signature = _record(item.get("signature"))
        value = _number(signature.get(key))
        similarity = _number(item.get("similarity"))
        confidence = _number(item.get("confidence"))
        if value is None or similarity is None or confidence is None:
            continue
        weight = max(0.05, similarity * confidence)
        pairs.append((value, weight))
    if not pairs:
        return None
    total_weight = sum(weight for _, weight in pairs)
    return sum(value * weight for value, weight in pairs) / total_weight


def weighted_reference_bands(
    selection: dict[str, Any],
    band_key: str,
) -> dict[str, float]:
    selected = [
        item for item in _list(selection.get("selected"))
        if isinstance(item, dict)
    ]
    keys: set[str] = set()
    for item in selected:
        signature = _record(item.get("signature"))
        keys.update(_record(signature.get(band_key)).keys())

    result: dict[str, float] = {}
    for key in sorted(keys):
        pairs: list[tuple[float, float]] = []
        for item in selected:
            signature = _record(item.get("signature"))
            value = _number(_record(signature.get(band_key)).get(key))
            similarity = _number(item.get("similarity"))
            confidence = _number(item.get("confidence"))
            if value is None or similarity is None or confidence is None:
                continue
            pairs.append((value, max(0.05, similarity * confidence)))
        if pairs:
            total_weight = sum(weight for _, weight in pairs)
            result[key] = sum(value * weight for value, weight in pairs) / total_weight
    return result
