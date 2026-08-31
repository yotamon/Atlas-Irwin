import { NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXISTING_SMOKE_SANDBOX = "atlas-media-worker-bootstrap-smoke-b7a402cd84";

function revision() {
  const value = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "";
  return /^[a-f0-9]{40}$/i.test(value) ? value : "main";
}

function inferenceScript() {
  return `set -uo pipefail
ROOT=/workspace/atlas-bootstrap-smoke
STATUS="$ROOT/inference-status"
LOG="$ROOT/inference.log"
VENV="$ROOT/.venv"
printf 'running' > "$STATUS"
(
  "$VENV/bin/python" - <<'PY'
from pathlib import Path
import math
import struct
import wave

path = Path('/workspace/atlas-bootstrap-smoke/synthetic.wav')
sr = 22050
duration = 32
with wave.open(str(path), 'wb') as handle:
    handle.setnchannels(1)
    handle.setsampwidth(2)
    handle.setframerate(sr)
    frames = bytearray()
    for i in range(sr * duration):
        t = i / sr
        beat = int(t * 2) % 8
        section = int(t // 8) % 4
        fundamental = (220.0, 246.94, 261.63, 293.66)[section]
        envelope = 0.55 + (0.35 if (t % 0.5) < 0.075 else 0.0)
        harmonic = math.sin(2 * math.pi * fundamental * t)
        harmonic += 0.35 * math.sin(2 * math.pi * fundamental * 1.5 * t)
        if beat in (0, 4):
            harmonic += 0.25 * math.sin(2 * math.pi * 110 * t)
        value = max(-1.0, min(1.0, harmonic * envelope * 0.35))
        frames.extend(struct.pack('<h', int(value * 32767)))
    handle.writeframes(frames)
print(path)
PY

  "$VENV/bin/python" - <<'PY'
import allin1_infer
path = '/workspace/atlas-bootstrap-smoke/synthetic.wav'
result = allin1_infer.analyze(path)
print('INFERENCE_READY')
print('bpm', getattr(result, 'bpm', None))
print('beats', len(list(getattr(result, 'beats', []) or [])))
print('downbeats', len(list(getattr(result, 'downbeats', []) or [])))
print('segments', [(str(s.label), round(float(s.start), 3), round(float(s.end), 3)) for s in list(getattr(result, 'segments', []) or [])[:8]])
PY
  printf 'ready' > "$STATUS"
) >"$LOG" 2>&1 || printf 'failed' > "$STATUS"
`;
}

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const sandbox = await Sandbox.get({ name: EXISTING_SMOKE_SANDBOX });
    const command = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", inferenceScript()],
      detached: true,
    });
    return NextResponse.json({
      ok: command.exitCode === null || command.exitCode === 0,
      action: "semantic_inference_started",
      sandbox: EXISTING_SMOKE_SANDBOX,
      revision: revision(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
