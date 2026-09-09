from __future__ import annotations

from typing import Any

CONTRACT_VERSION = 1
CONTRACT_PAYLOAD_KEY = "__ensemblis_media_worker_contract_version"
JOB_TYPES = frozenset({
    "analyze_audio",
    "analyze_stem",
    "extract_frame",
    "render_master",
    "render_social",
    "render_promo",
    "render_hook",
    "render_audio_scene",
    "master_audio",
    "finish_social_video",
    "render_automix",
})


def validate_request_envelope(value: dict[str, Any]) -> None:
    job_type = value.get("job_type")
    if job_type not in JOB_TYPES:
        raise ValueError(f"Unsupported Media Worker job type: {job_type!r}")

    payload = value.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("Media Worker payload must be an object")

    version = payload.get(CONTRACT_PAYLOAD_KEY)
    if version != CONTRACT_VERSION:
        raise ValueError(
            f"Unsupported Media Worker contract version: {version!r}; expected {CONTRACT_VERSION}"
        )
