from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from bridge_analyzer import ANALYZER_VERSION, analyze
from bridge_renderer import PROTOCOL_VERSION as RENDERER_VERSION, execute as render

SIDECAR_VERSION = "ensemblis.library-bridge.sidecar.v1"


def main() -> int:
    parser = argparse.ArgumentParser(description="Ensemblis Library Bridge local intelligence sidecar")
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyzer = subparsers.add_parser("analyze")
    analyzer.add_argument("--source", required=True)
    analyzer.add_argument("--fingerprint", required=True)
    analyzer.add_argument("--result", required=True)

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
        if args.command == "render":
            render(Path(args.request), Path(args.result))
            return 0
        if args.command == "version":
            payload = {
                "version": SIDECAR_VERSION,
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
