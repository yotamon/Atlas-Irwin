import { NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SMOKE_NAME = "atlas-media-worker-universal-smoke-v1";
const UNIVERSAL_IMAGE = "vercel/sandbox/universal@sha256:0e3e3617e824397f170fc7c43ccaa565dd7ac36518e83ead3d41e077cd9f6ec7";

function revision() {
  const value = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "";
  return /^[a-f0-9]{40}$/i.test(value) ? value : "main";
}

function smokeScript() {
  const requirementsUrl = `https://raw.githubusercontent.com/yotamon/Atlas-Irwin/${revision()}/services/media-worker/requirements.txt`;
  return `set -uo pipefail
ROOT=/workspace/atlas-universal-smoke
STATUS="$ROOT/status"
LOG="$ROOT/smoke.log"
mkdir -p "$ROOT"
printf 'running' > "$STATUS"
(
  uv python install 3.13
  rm -rf "$ROOT/.venv"
  uv venv --python 3.13 "$ROOT/.venv"
  "$ROOT/.venv/bin/python" - <<'PY'
import bz2
import lzma
import sqlite3
import ssl
import sys
print('PYTHON_SYSTEM_READY')
print(sys.version)
print(bz2.__file__)
PY
  python3 - ${JSON.stringify(requirementsUrl)} "$ROOT/requirements.txt" <<'PY'
from pathlib import Path
import sys
from urllib.request import urlopen
url, target = sys.argv[1], Path(sys.argv[2])
target.write_bytes(urlopen(url, timeout=30).read())
PY
  uv pip install --python "$ROOT/.venv/bin/python" -r "$ROOT/requirements.txt"
  "$ROOT/.venv/bin/python" - <<'PY'
from pathlib import Path
import math
import struct
import wave
import allin1_infer
import imageio_ffmpeg

path = Path('/workspace/atlas-universal-smoke/synthetic.wav')
sr = 22050
duration = 32
with wave.open(str(path), 'wb') as handle:
    handle.setnchannels(1)
    handle.setsampwidth(2)
    handle.setframerate(sr)
    frames = bytearray()
    for i in range(sr * duration):
        t = i / sr
        section = int(t // 8) % 4
        fundamental = (220.0, 246.94, 261.63, 293.66)[section]
        pulse = 0.35 if (t % 0.5) < 0.075 else 0.0
        value = math.sin(2 * math.pi * fundamental * t)
        value += 0.3 * math.sin(2 * math.pi * fundamental * 1.5 * t)
        value = max(-1.0, min(1.0, value * (0.4 + pulse) * 0.45))
        frames.extend(struct.pack('<h', int(value * 32767)))
    handle.writeframes(frames)

result = allin1_infer.analyze(str(path))
print('INFERENCE_READY')
print('bpm', getattr(result, 'bpm', None))
print('beats', len(list(getattr(result, 'beats', []) or [])))
print('downbeats', len(list(getattr(result, 'downbeats', []) or [])))
print('segments', len(list(getattr(result, 'segments', []) or [])))
print('ffmpeg', imageio_ffmpeg.get_ffmpeg_exe())
PY
  printf 'ready' > "$STATUS"
) >"$LOG" 2>&1 || printf 'failed' > "$STATUS"
`;
}

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sandbox = await Sandbox.getOrCreate({
    name: SMOKE_NAME,
    image: UNIVERSAL_IMAGE,
    resources: { vcpus: 4 },
    timeout: 45 * 60 * 1000,
    persistent: true,
    keepLastSnapshots: { count: 1 },
    tags: { app: "atlas-irwin", role: "universal-worker-smoke" },
  });

  const command = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", smokeScript()],
    detached: true,
  });

  return NextResponse.json({
    ok: command.exitCode === null || command.exitCode === 0,
    action: "started",
    sandbox: SMOKE_NAME,
    image: sandbox.image,
    revision: revision(),
  });
}
