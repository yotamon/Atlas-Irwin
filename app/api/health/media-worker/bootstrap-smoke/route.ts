import { NextRequest, NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXISTING_SMOKE_SANDBOX = "atlas-media-worker-bootstrap-smoke-b7a402cd84";

function revision() {
  const value = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "";
  return /^[a-f0-9]{40}$/i.test(value) ? value : "main";
}

async function existingSandbox() {
  return Sandbox.get({ name: EXISTING_SMOKE_SANDBOX });
}

async function readStatus(sandbox: Sandbox) {
  const statusCommand = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", "ROOT=/workspace/atlas-bootstrap-smoke; printf '%s\\n' \"$(cat \\\"$ROOT/status\\\" 2>/dev/null || echo not_started)\"; tail -c 7000 \"$ROOT/bootstrap.log\" 2>/dev/null || true"],
  });
  const output = await statusCommand.stdout();
  const [status = "unknown", ...logLines] = output.trim().split("\n");
  return { status, log: logLines.join("\n") };
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const sandbox = await existingSandbox();
    const action = request.nextUrl.searchParams.get("action") || "status";

    if (action === "stop") {
      const beforeStop = await readStatus(sandbox);
      await sandbox.stop();
      return NextResponse.json({
        ok: true,
        action: "stopped",
        sandbox: EXISTING_SMOKE_SANDBOX,
        revision: revision(),
        result: beforeStop,
      });
    }

    const result = await readStatus(sandbox);
    console.log("Atlas bootstrap smoke result", JSON.stringify(result));
    return NextResponse.json({
      ok: result.status === "ready",
      sandbox: EXISTING_SMOKE_SANDBOX,
      revision: revision(),
      ...result,
    }, { status: result.status === "failed" ? 500 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Atlas bootstrap smoke read failed", message);
    return NextResponse.json({
      ok: false,
      status: "unavailable",
      sandbox: EXISTING_SMOKE_SANDBOX,
      revision: revision(),
      error: message,
    }, { status: 500 });
  }
}
