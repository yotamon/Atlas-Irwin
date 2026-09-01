import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";

export const MEDIA_WORKER_CALLBACK_HASH_KEY = "__atlas_callback_token_sha256";
const MEDIA_WORKER_RUNTIME_VERSION = 8;
const MEDIA_WORKER_BOOTSTRAP_VERSION = 4;
const MEDIA_WORKER_PYTHON_VERSION = "3.13.14";
const MEDIA_WORKER_SANDBOX_IMAGE = "vercel/sandbox/universal@sha256:0e3e3617e824397f170fc7c43ccaa565dd7ac36518e83ead3d41e077cd9f6ec7";
const HOBBY_MAX_SANDBOX_MS = 45 * 60 * 1000;
const WORKDIR = "/workspace/atlas-media-worker";
const LOCKDIR = "/tmp/atlas-media-worker.lock";

function environmentName() {
  return process.env.VERCEL_ENV?.trim() === "production" ? "production" : "preview";
}

export function mediaWorkerSandboxName() {
  return `atlas-media-worker-${environmentName()}-v${MEDIA_WORKER_RUNTIME_VERSION}`;
}

function sourceRevision() {
  const value = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "";
  return /^[a-f0-9]{40}$/i.test(value) ? value : "main";
}

export function mediaWorkerSandboxAvailable() {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_TOKEN?.trim());
}

export function mediaWorkerReadiness() {
  return {
    configured: mediaWorkerSandboxAvailable(),
    runtime: "vercel_sandbox" as const,
    sandboxName: mediaWorkerSandboxName(),
    sandboxImage: MEDIA_WORKER_SANDBOX_IMAGE,
    pythonVersion: MEDIA_WORKER_PYTHON_VERSION,
    workerVersion: MEDIA_WORKER_RUNTIME_VERSION,
    bootstrapVersion: MEDIA_WORKER_BOOTSTRAP_VERSION,
  };
}

export function createMediaWorkerCallbackCredential() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: createHash("sha256").update(token).digest("hex"),
  };
}

async function commandError(command: { stderr: () => Promise<string> }) {
  return (await command.stderr()).trim();
}

function sandboxDispatchError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (/quota|limit|billing|payment|resource|429|hobby/i.test(detail)) {
    return "Vercel Hobby Sandbox quota is unavailable right now. Atlas did not use a paid fallback. Try again after the free quota resets.";
  }
  if (/already processing|worker is busy/i.test(detail)) return detail;
  return `Vercel Sandbox dispatch failed: ${detail}`;
}

export async function getMediaWorkerSandbox() {
  if (!mediaWorkerSandboxAvailable()) {
    throw new Error("Vercel Sandbox is unavailable outside a Vercel deployment. Atlas did not use a paid fallback.");
  }
  return Sandbox.getOrCreate({
    name: mediaWorkerSandboxName(),
    image: MEDIA_WORKER_SANDBOX_IMAGE,
    resources: { vcpus: 4 },
    timeout: HOBBY_MAX_SANDBOX_MS,
    persistent: true,
    keepLastSnapshots: { count: 1 },
    tags: {
      app: "atlas-irwin",
      role: "media-worker",
      environment: environmentName(),
      version: String(MEDIA_WORKER_RUNTIME_VERSION),
    },
  });
}

async function acquireWorkerLock(sandbox: Sandbox) {
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `set -e
if [ -d ${LOCKDIR} ]; then
  started=$(cat ${LOCKDIR}/started_at 2>/dev/null || echo 0)
  now=$(date +%s)
  if [ $((now-started)) -gt 3000 ]; then
    rm -rf ${LOCKDIR}
  fi
fi
if ! mkdir ${LOCKDIR} 2>/dev/null; then
  echo "The free Media Worker is already processing another job." >&2
  exit 75
fi
date +%s > ${LOCKDIR}/started_at
`],
  });
  if (result.exitCode !== 0) {
    throw new Error((await commandError(result)) || "The free Media Worker is already processing another job. Atlas keeps concurrency at 1 to protect the Hobby quota.");
  }
}

async function releaseWorkerLock(sandbox: Sandbox) {
  await sandbox.runCommand("rm", ["-rf", LOCKDIR]).catch(() => undefined);
}

function detachedWorkerScript(requestPath: string) {
  const revision = sourceRevision();
  const base = `https://raw.githubusercontent.com/yotamon/Atlas-Irwin/${revision}/services/media-worker`;
  return `set -uo pipefail
REQUEST=${JSON.stringify(requestPath)}
WORKDIR=${JSON.stringify(WORKDIR)}
LOCKDIR=${JSON.stringify(LOCKDIR)}
BASE=${JSON.stringify(base)}
BOOTSTRAP_VERSION=${MEDIA_WORKER_BOOTSTRAP_VERSION}
PYTHON_VERSION=${JSON.stringify(MEDIA_WORKER_PYTHON_VERSION)}
LOG=/tmp/atlas-media-worker-bootstrap.log
export UV_PYTHON_INSTALL_DIR="$WORKDIR/.uv-python"
export UV_CACHE_DIR="$WORKDIR/.uv-cache"
export TORCH_HOME="$WORKDIR/.torch"
export HF_HOME="$WORKDIR/.huggingface"
export PYTHONPATH="$WORKDIR"

cleanup() {
  rm -rf "$LOCKDIR"
}
trap cleanup EXIT

notify_failed() {
  detail=$(tail -c 2500 "$LOG" 2>/dev/null || echo "Media Worker job failed")
  python3 - "$REQUEST" "$detail" <<'PY'
import json
import sys
from urllib.request import Request, urlopen

path, detail = sys.argv[1], sys.argv[2]
try:
    payload = json.loads(open(path, "r", encoding="utf-8").read())
    body = json.dumps({
        "job_id": payload.get("job_id"),
        "status": "failed",
        "result": {},
        "error": f"Media Worker job failed: {detail[-2200:]}",
    }).encode("utf-8")
    request = Request(
        payload["callback_url"],
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {payload['callback_token']}",
            "Content-Type": "application/json",
        },
    )
    urlopen(request, timeout=30).read()
except Exception:
    pass
PY
  rm -f "$REQUEST"
}

bootstrap() {
  mkdir -p "$WORKDIR/app"
  python3 - "$BASE" "$WORKDIR" <<'PY'
from pathlib import Path
import sys
from urllib.request import urlopen

base, root_value = sys.argv[1], sys.argv[2]
root = Path(root_value)
files = {
    "app/main.py": f"{base}/app/main.py",
    "app/music_intelligence.py": f"{base}/app/music_intelligence.py",
    "app/stem_intelligence.py": f"{base}/app/stem_intelligence.py",
    "app/runner.py": f"{base}/app/runner.py",
    "requirements.txt": f"{base}/requirements.txt",
}
for relative, url in files.items():
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(urlopen(url, timeout=30).read())
PY

  requirements_sha=$(sha256sum "$WORKDIR/requirements.txt" | cut -d' ' -f1)
  required=$(printf '%s:%s:%s' "$BOOTSTRAP_VERSION" "$PYTHON_VERSION" "$requirements_sha" | sha256sum | cut -d' ' -f1)
  installed=$(cat "$WORKDIR/.requirements.sha" 2>/dev/null || true)
  if [ ! -x "$WORKDIR/.venv/bin/python" ] || [ "$required" != "$installed" ]; then
    rm -rf "$WORKDIR/.venv"
    uv python install "$PYTHON_VERSION"
    uv venv --python "$PYTHON_VERSION" "$WORKDIR/.venv"
    uv pip install --python "$WORKDIR/.venv/bin/python" -r "$WORKDIR/requirements.txt"

    "$WORKDIR/.venv/bin/python" - <<'PY'
import bz2
import lzma
import sqlite3
import ssl
import allin1_infer
import imageio_ffmpeg
print("Atlas Media Worker dependencies ready", imageio_ffmpeg.get_ffmpeg_exe())
PY
    printf '%s' "$required" > "$WORKDIR/.requirements.sha"
    rm -rf "$UV_CACHE_DIR"
  fi

  "$WORKDIR/.venv/bin/python" - <<'PY'
import bz2
import allin1_infer
import imageio_ffmpeg
from app.stem_intelligence import ANALYSIS_VERSION
print("Atlas Media Worker ready", imageio_ffmpeg.get_ffmpeg_exe(), "stem-analysis", ANALYSIS_VERSION)
PY
}

if ! bootstrap >"$LOG" 2>&1; then
  notify_failed
  exit 1
fi

cd "$WORKDIR"
if ! "$WORKDIR/.venv/bin/python" -m app.runner "$REQUEST" >>"$LOG" 2>&1; then
  notify_failed
  exit 1
fi
`;
}

export async function dispatchMediaWorkerJob(input: {
  jobId: string;
  jobType:
    | "analyze_audio"
    | "analyze_stem"
    | "extract_frame"
    | "render_master"
    | "render_social"
    | "render_promo"
    | "render_hook"
    | "render_audio_scene"
    | "finish_social_video";
  payload: Record<string, unknown>;
  callbackUrl: string;
  callbackToken: string;
}) {
  let sandbox: Sandbox | null = null;
  let locked = false;
  try {
    sandbox = await getMediaWorkerSandbox();
    await acquireWorkerLock(sandbox);
    locked = true;

    const requestPath = `/tmp/atlas-worker-${input.jobId.replace(/[^a-zA-Z0-9_-]/g, "-")}.json`;
    await sandbox.writeFiles([{
      path: requestPath,
      content: JSON.stringify({
        job_id: input.jobId,
        job_type: input.jobType,
        payload: input.payload,
        callback_url: input.callbackUrl,
        callback_token: input.callbackToken,
      }),
    }]);

    const command = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", detachedWorkerScript(requestPath)],
      detached: true,
    });
    if (command.exitCode !== null && command.exitCode !== 0) {
      throw new Error((await commandError(command)) || "Could not start the Media Worker runner.");
    }
    return { sandboxName: mediaWorkerSandboxName() };
  } catch (error) {
    if (sandbox && locked) await releaseWorkerLock(sandbox);
    if (sandbox) await sandbox.stop().catch(() => undefined);
    throw new Error(sandboxDispatchError(error));
  }
}

export function scheduleMediaWorkerSandboxCleanup() {
  const name = mediaWorkerSandboxName();
  return async () => {
    try {
      const sandbox = await Sandbox.get({ name });
      await sandbox.stop();
    } catch {
      // The Sandbox may already be stopped or have reached its Hobby timeout.
    }
    // Terminal callbacks invoke this only after durable state has been reconciled. Give the
    // detached runner a moment to release its lock, then dispatch the oldest queued job.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    let dispatched = false;
    try {
      const { kickMediaWorkerQueue } = await import("@/lib/media-worker/queue");
      const result = await kickMediaWorkerQueue();
      dispatched = result.dispatched;
    } catch {
      // Existing queue work is durable. Give marketing finishing a chance below.
    }
    if (!dispatched) {
      try {
        const { kickMarketingMediaWorkerQueue } = await import("@/lib/marketing/media-worker-queue");
        await kickMarketingMediaWorkerQueue();
      } catch {
        // Marketing media work is durable. A later enqueue/callback/request will kick it again.
      }
    }
  };
}
