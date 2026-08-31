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

async function readInference(sandbox: Sandbox) {
  const command = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `ROOT=/workspace/atlas-bootstrap-smoke
status=$(cat "$ROOT/inference-status" 2>/dev/null || echo not_started)
printf '%s\n' "$status"
tail -c 9000 "$ROOT/inference.log" 2>/dev/null || true`],
  });
  const output = await command.stdout();
  const [status = "unknown", ...logLines] = output.trim().split("\n");
  return { status, log: logLines.join("\n") };
}

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const sandbox = await Sandbox.get({ name: EXISTING_SMOKE_SANDBOX });
    const result = await readInference(sandbox);
    if (result.status !== "running") await sandbox.stop();
    console.log("Atlas semantic inference smoke result", JSON.stringify(result));
    return NextResponse.json({
      ok: result.status === "ready" && result.log.includes("INFERENCE_READY"),
      action: result.status === "running" ? "still_running" : "verified_and_stopped",
      sandbox: EXISTING_SMOKE_SANDBOX,
      revision: revision(),
      ...result,
    }, { status: result.status === "failed" ? 500 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Atlas semantic inference smoke read failed", message);
    return NextResponse.json({ ok: false, status: "unavailable", error: message }, { status: 500 });
  }
}
