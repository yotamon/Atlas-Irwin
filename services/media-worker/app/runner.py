from __future__ import annotations

import asyncio
import json
import shutil
import sys
from pathlib import Path

from . import main as worker_main
from .automix import AutomixWorkerRequest, execute_automix
from .contract import validate_request_envelope
from .mastering_processor import MasteringWorkerRequest, execute_mastering
from .music_intelligence_v4_runtime import analyze_music as analyze_music_v4
from .social_finishing import SocialWorkerRequest, execute_social
from .stem_intelligence_v3 import analyze_stem as analyze_stem_v3

# Keep the stable analyzers importable for rollback, but route production Sandbox
# entrypoints through the new post-processing layers.
worker_main.analyze_music = analyze_music_v4
worker_main.analyze_stem = analyze_stem_v3
WorkerRequest = worker_main.WorkerRequest
execute = worker_main.execute

LOCK_PATH = Path("/tmp/atlas-media-worker.lock")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m app.runner <request-json>")

    request_path = Path(sys.argv[1])
    try:
        raw = request_path.read_text(encoding="utf-8")
        payload = json.loads(raw)
        validate_request_envelope(payload)
        if payload.get("job_type") == "finish_social_video":
            request = SocialWorkerRequest.model_validate(payload)
            executor = execute_social
        elif payload.get("job_type") == "master_audio":
            request = MasteringWorkerRequest.model_validate(payload)
            executor = execute_mastering
        elif payload.get("job_type") == "render_automix":
            request = AutomixWorkerRequest.model_validate(payload)
            executor = execute_automix
        else:
            request = WorkerRequest.model_validate(payload)
            executor = execute
    finally:
        # The raw one-time callback token must never survive into a persistent Sandbox snapshot.
        request_path.unlink(missing_ok=True)

    try:
        asyncio.run(executor(request))
    finally:
        shutil.rmtree(LOCK_PATH, ignore_errors=True)


if __name__ == "__main__":
    main()
