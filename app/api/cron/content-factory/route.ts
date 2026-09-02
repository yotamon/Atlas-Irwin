import { Sandbox } from "@vercel/sandbox";
import { authorizeMarketingCron } from "@/lib/marketing/cron-auth";
import { fillOneMissingScheduledAsset } from "@/lib/marketing/free-content-factory";

const COMPOSER_SANDBOX_NAME = "atlas-free-content-factory";
const COMPOSER_BOOTSTRAP_TIMEOUT_MS = 180_000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The first run may need to install ffmpeg-static inside the persistent Sandbox.
// Keep the function window above that bootstrap while remaining inside Hobby/Fluid limits.
export const maxDuration = 240;

async function prepareComposerSandbox() {
  const sandbox = await Sandbox.getOrCreate({
    name: COMPOSER_SANDBOX_NAME,
    runtime: "node24",
    resources: { vcpus: 2 },
    timeout: COMPOSER_BOOTSTRAP_TIMEOUT_MS,
    persistent: true,
    resume: true,
    keepLastSnapshots: { count: 1 },
    tags: { app: "atlas-irwin", role: "free-content-factory" },
  });
  const check = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", "test -d /workspace/node_modules/ffmpeg-static"],
  });
  if (check.exitCode !== 0) {
    const setup = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", "mkdir -p /workspace && cd /workspace && test -f package.json || npm init -y >/dev/null 2>&1; npm install ffmpeg-static@5.2.0 --omit=dev >/dev/null 2>&1"],
    });
    if (setup.exitCode !== 0) {
      const stderr = (await setup.stderr()).trim();
      throw new Error(`Could not bootstrap the free composer Sandbox: ${stderr.slice(-1200)}`);
    }
  }
  return sandbox;
}

export async function GET(request: Request) {
  const auth = await authorizeMarketingCron(request);
  if (!auth.authorized) {
    if (!auth.configured) {
      return Response.json({ error: "Marketing cron authentication is not provisioned." }, { status: 503 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  let preparedSandbox: Sandbox | null = null;
  try {
    preparedSandbox = await prepareComposerSandbox();
    const result = await fillOneMissingScheduledAsset();
    return Response.json({
      ok: true,
      mode: "free-tier-safe-content-factory",
      authSource: auth.source,
      result,
    });
  } catch (error) {
    console.error("[content-factory-cron] composition cycle failed", error);
    return Response.json({
      ok: false,
      mode: "free-tier-safe-content-factory",
      authSource: auth.source,
      error: error instanceof Error ? error.message : "Content factory cycle failed.",
    }, { status: 500 });
  } finally {
    if (preparedSandbox) {
      try { await preparedSandbox.stop(); } catch { /* best effort; factory may already stop it */ }
    }
  }
}
