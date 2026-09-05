from __future__ import annotations

import asyncio
import json
import shutil
import sys
from pathlib import Path

from . import main as worker_main
from .music_intelligence_v4 import analyze_music as analyze_music_v4
from .social_finishing import SocialWorkerRequest, execute_social

# V4 deliberately wraps the stable V3 analyzer. Keeping the swap at the worker
# entrypoint makes rollback trivial while every production Sandbox job uses V4.
worker_main.analyze_music = analyze_music_v4
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
        if payload.get("job_type") == "finish_social_video":
            request = SocialWorkerRequest.model_validate(payload)
            executor = execute_social
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
