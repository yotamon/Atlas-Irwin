from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from .main import WorkerRequest, execute


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m app.runner <worker-request.json>")

    request_path = Path(sys.argv[1])
    request = WorkerRequest.model_validate_json(request_path.read_text(encoding="utf-8"))
    asyncio.run(execute(request))


if __name__ == "__main__":
    main()
