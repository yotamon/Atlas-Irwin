from __future__ import annotations

import asyncio
import shutil
import sys
from pathlib import Path

from .main import WorkerRequest, execute

LOCK_PATH = Path("/tmp/atlas-media-worker.lock")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m app.runner <request-json>")

    request_path = Path(sys.argv[1])
    try:
        request = WorkerRequest.model_validate_json(request_path.read_text(encoding="utf-8"))
    finally:
        # The raw one-time callback token must never survive into a persistent Sandbox snapshot.
        request_path.unlink(missing_ok=True)

    try:
        asyncio.run(execute(request))
    finally:
        shutil.rmtree(LOCK_PATH, ignore_errors=True)


if __name__ == "__main__":
    main()
