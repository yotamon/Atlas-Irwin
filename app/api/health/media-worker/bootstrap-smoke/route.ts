import { NextRequest, NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function revision() {
  const value = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "";
  return /^[a-f0-9]{40}$/i.test(value) ? value : "main";
}

function sandboxName() {
  return `atlas-media-worker-bootstrap-smoke-${revision().slice(0, 10)}`;
}

function bootstrapScript() {
  const requirementsUrl = `https://raw.githubusercontent.com/yotamon/Atlas-Irwin/${revision()}/services/media-worker/requirements.txt`;
  return `set -uo pipefail
ROOT=/workspace/atlas-bootstrap-smoke
STATUS="$ROOT/status"
LOG="$ROOT/bootstrap.log"
mkdir -p "$ROOT"
if [ "$(cat "$STATUS" 2>/dev/null || true)" = "running" ]; then exit 0; fi
(
  printf 'running' > "$STATUS"
  rm -rf "$ROOT/.venv" "$ROOT/get-pip.py"
  python -m venv --without-pip "$ROOT/.venv"
  python - ${JSON.stringify("https://bootstrap.pypa.io/get-pip.py")} "$ROOT/get-pip.py" <<'PY'
from pathlib import Path
import sys
from urllib.request import urlopen
url, target = sys.argv[1], Path(sys.argv[2])
target.write_bytes(urlopen(url, timeout=30).read())
PY
  "$ROOT/.venv/bin/python" "$ROOT/get-pip.py" "pip==25.2"
  "$ROOT/.venv/bin/python" -m pip install --disable-pip-version-check "setuptools==80.9.0" "wheel==0.45.1"
  python - ${JSON.stringify(requirementsUrl)} "$ROOT/requirements.txt" <<'PY'
from pathlib import Path
import sys
from urllib.request import urlopen
url, target = sys.argv[1], Path(sys.argv[2])
target.write_bytes(urlopen(url, timeout=30).read())
PY
  "$ROOT/.venv/bin/python" -m pip install --disable-pip-version-check -r "$ROOT/requirements.txt"
  "$ROOT/.venv/bin/python" - <<'PY'
import allin1_infer
import imageio_ffmpeg
import pip
print("BOOTSTRAP_READY")
print("pip", pip.__version__)
print("allin1_infer", getattr(allin1_infer, "__version__", "unknown"))
print("ffmpeg", imageio_ffmpeg.get_ffmpeg_exe())
PY
  printf 'ready' > "$STATUS"
) >"$LOG" 2>&1 || printf 'failed' > "$STATUS"
`;
}

async function getSandbox() {
  return Sandbox.getOrCreate({
    name: sandboxName(),
    runtime: "python3.13",
    resources: { vcpus: 4 },
    timeout: 20 * 60 * 1000,
    persistent: true,
    keepLastSnapshots: { count: 1 },
    tags: { app: "atlas-irwin", role: "bootstrap-smoke", revision: revision().slice(0, 10) },
  });
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const action = request.nextUrl.searchParams.get("action") || "status";
  const sandbox = await getSandbox();

  if (action === "start") {
    const command = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", bootstrapScript()],
      detached: true,
    });
    return NextResponse.json({
      ok: command.exitCode === null || command.exitCode === 0,
      action: "started",
      sandbox: sandboxName(),
      revision: revision(),
    });
  }

  if (action === "stop") {
    await sandbox.stop();
    return NextResponse.json({ ok: true, action: "stopped", sandbox: sandboxName() });
  }

  const statusCommand = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", "ROOT=/workspace/atlas-bootstrap-smoke; printf '%s\\n' \"$(cat \\\"$ROOT/status\\\" 2>/dev/null || echo not_started)\"; tail -c 5000 \"$ROOT/bootstrap.log\" 2>/dev/null || true"],
  });
  const output = await statusCommand.stdout();
  const [status = "unknown", ...logLines] = output.trim().split("\n");
  return NextResponse.json({
    ok: status === "ready",
    status,
    sandbox: sandboxName(),
    revision: revision(),
    log: logLines.join("\n"),
  }, { status: status === "failed" ? 500 : 200 });
}
