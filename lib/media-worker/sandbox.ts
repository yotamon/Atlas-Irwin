import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";

export const MEDIA_WORKER_CALLBACK_HASH_KEY = "__atlas_callback_token_sha256";
const MEDIA_WORKER_RUNTIME_VERSION = 3;
const HOBBY_MAX_SANDBOX_MS = 45 * 60 * 1000;
const WORKDIR = "/workspace/atlas-media-worker";
const LOCKDIR = "/tmp/atlas-media-worker.lock";

function environmentName() {
  const env = process.env.VERCEL_ENV?.trim();
  return env === "production" ? "production" : "preview";
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
    workerVersion: 3,
  };
}

export function createMediaWorkerCallbackCredential() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: createHash("sha256").update(token).digest("hex"),
  };
}

export function mediaWorkerCallbackHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function commandError(command: Awaited<ReturnType<Sandbox["runCommand"]>>) {
  return command.stderr().then((value) => value.trim());
}

function sandboxDispatchError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (/quota|limit|billing|payment|resource|429|hobby/i.test(detail)) {
    return "Vercel Hobby Sandbox quota is unavailable right now. Atlas did not use a paid fallback. Try again after the free quota resets.";
  }
  if (/already processing|worker is busy/i.test(detail)) return detail;
  return `Vercel Sandbox dispatch failed: ${detail}`;
}

async function bootstrapWorker(sandbox: Sandbox) {
  const revision = sourceRevision();
  const base = `https://raw.githubusercontent.com/yotamon/Atlas-Irwin/${revision}/services/media-worker`;
  const bootstrap = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `set -euo pipefail
mkdir -p ${WORKDIR}/app
python - <<'PY'
from pathlib import Path
from urllib.request import urlopen

base = ${JSON.stringify(base)}
root = Path(${JSON.stringify(WORKDIR)})
files = {
    "app/main.py": f"{base}/app/main.py",
    "app/music_intelligence.py": f"{base}/app/music_intelligence.py",
    "app/runner.py": f"{base}/app/runner.py",
    "requirements.txt": f"{base}/requirements.txt",
}
for relative, url in files.items():
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(urlopen(url, timeout=30).read())
PY
python -m venv ${WORKDIR}/.venv
${WORKDIR}/.venv/bin/python -m pip install --disable-pip-version-check --upgrade pip setuptools wheel
${WORKDIR}/.venv/bin/python -m pip install --disable-pip-version-check -r ${WORKDIR}/requirements.txt
${WORKDIR}/.venv/bin/python - <<'PY'
import allin1_infer
import imageio_ffmpeg
print("Atlas Media Worker ready", getattr(allin1_infer, "__version__", "unknown"), imageio_ffmpeg.get_ffmpeg_exe())
PY
`],
  });
  if (bootstrap.exitCode !== 0) {
    throw new Error(`Could not initialize the Media Worker Sandbox: ${(await commandError(bootstrap)).slice(-3000)}`);
  }
}

export async function getMediaWorkerSandbox() {
  if (!mediaWorkerSandboxAvailable()) {
    throw new Error("Vercel Sandbox is unavailable outside a Vercel deployment. Atlas did not use a paid fallback.");
  }
  return Sandbox.getOrCreate({
    name: mediaWorkerSandboxName(),
    runtime: "python3.13",
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
    onCreate: bootstrapWorker,
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

export async function dispatchMediaWorkerJob(input: {
  jobId: string;
  jobType: "analyze_audio" | "extract_frame" | "render_master" | "render_social" | "render_promo" | "render_hook";
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
      cmd: `${WORKDIR}/.venv/bin/python`,
      args: ["-m", "app.runner", requestPath],
      cwd: WORKDIR,
      detached: true,
    });
    if (command.exitCode !== 0) {
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
  };
}
