import { NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SMOKE_NAME = "atlas-media-worker-universal-smoke-v1";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const sandbox = await Sandbox.get({ name: SMOKE_NAME });
    const command = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", `ROOT=/workspace/atlas-universal-smoke
status=$(cat "$ROOT/status" 2>/dev/null || echo not_started)
printf '%s\n' "$status"
tail -c 12000 "$ROOT/smoke.log" 2>/dev/null || true`],
    });
    const output = await command.stdout();
    const [status = "unknown", ...lines] = output.trim().split("\n");
    const log = lines.join("\n");
    const ok = status === "ready" && log.includes("PYTHON_SYSTEM_READY") && log.includes("INFERENCE_READY");
    if (status !== "running") await sandbox.stop().catch(() => undefined);
    return NextResponse.json({
      ok,
      action: status === "running" ? "still_running" : "verified_and_stopped",
      status,
      sandbox: SMOKE_NAME,
      log,
    }, { status: status === "failed" ? 500 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, status: "unavailable", error: message }, { status: 500 });
  }
}
