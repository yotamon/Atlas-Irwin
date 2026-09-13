from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from bridge_analyzer import ANALYSIS_PAYLOAD_VERSION, ANALYZER_VERSION, analyze
from bridge_renderer import PROTOCOL_VERSION as RENDERER_VERSION, execute as render

SIDECAR_VERSION = "ensemblis.library-bridge.sidecar.v1"
ANALYSIS_BATCH_VERSION = "ensemblis.library-bridge.analysis-batch.v1"
MAX_ANALYSIS_BATCH = 8
MAX_BATCH_REQUEST_BYTES = 512 * 1024
_FINGERPRINT_RE = re.compile(r"^sha256:[a-f0-9]{64}$")


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _analyze_batch(request_path: Path, result_path: Path) -> None:
    if request_path.stat().st_size > MAX_BATCH_REQUEST_BYTES:
        raise ValueError("local analysis batch request is too large")
    request = json.loads(request_path.read_text(encoding="utf-8"))
    if not isinstance(request, dict) or request.get("version") != ANALYSIS_BATCH_VERSION:
        raise ValueError("unsupported local analysis batch protocol")
    raw_tracks = request.get("tracks")
    if not isinstance(raw_tracks, list) or not raw_tracks or len(raw_tracks) > MAX_ANALYSIS_BATCH:
        raise ValueError("local analysis batch requires 1-8 tracks")

    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_tracks:
        item = _record(raw)
        fingerprint = str(item.get("fingerprint") or "")
        source = str(item.get("source") or "")
        if not _FINGERPRINT_RE.fullmatch(fingerprint) or fingerprint in seen:
            raise ValueError("local analysis batch contains an invalid recording identity")
        seen.add(fingerprint)
        try:
            result = analyze(Path(source), fingerprint)
            if result.get("version") != ANALYSIS_PAYLOAD_VERSION or result.get("recordingFingerprint") != fingerprint:
                raise ValueError("local analyzer returned an invalid payload identity")
            rows.append({
                "fingerprint": fingerprint,
                "status": "completed",
                "result": result,
            })
        except Exception:
            # Batch output crosses back into Rust and may later inform UI state. Never copy exception
            # text because decoder/IO exceptions can contain the private filesystem path.
            rows.append({
                "fingerprint": fingerprint,
                "status": "failed",
                "error": "analysis_failed",
            })

    output = {
        "version": ANALYSIS_BATCH_VERSION,
        "analyzerVersion": ANALYZER_VERSION,
        "analysisPayloadVersion": ANALYSIS_PAYLOAD_VERSION,
        "tracks": rows,
    }
    result_path.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Ensemblis Library Bridge local intelligence sidecar")
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyzer = subparsers.add_parser("analyze")
    analyzer.add_argument("--source", required=True)
    analyzer.add_argument("--fingerprint", required=True)
    analyzer.add_argument("--result", required=True)

    batch = subparsers.add_parser("analyze-batch")
    batch.add_argument("--request", required=True)
    batch.add_argument("--result", required=True)

    renderer = subparsers.add_parser("render")
    renderer.add_argument("--request", required=True)
    renderer.add_argument("--result", required=True)

    version = subparsers.add_parser("version")
    version.add_argument("--json", action="store_true")

    args = parser.parse_args()
    try:
        if args.command == "analyze":
            output = analyze(Path(args.source), args.fingerprint)
            Path(args.result).write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
            return 0
        if args.command == "analyze-batch":
            _analyze_batch(Path(args.request), Path(args.result))
            return 0
        if args.command == "render":
            render(Path(args.request), Path(args.result))
            return 0
        if args.command == "version":
            payload = {
                "version": SIDECAR_VERSION,
                "analysisBatchVersion": ANALYSIS_BATCH_VERSION,
                "analysisPayloadVersion": ANALYSIS_PAYLOAD_VERSION,
                "analyzerVersion": ANALYZER_VERSION,
                "rendererVersion": RENDERER_VERSION,
            }
            print(json.dumps(payload, separators=(",", ":")) if args.json else SIDECAR_VERSION)
            return 0
        raise ValueError("unsupported sidecar command")
    except Exception as exc:
        # stderr is intentionally device-local. Rust maps failures to bounded path-free UI/cloud errors.
        print(f"Library Bridge sidecar failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
