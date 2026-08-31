import { Sandbox } from "@vercel/sandbox";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const suffix = (process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString()).slice(0, 10);
  const sandbox = await Sandbox.create({
    name: `atlas-media-worker-smoke-${suffix}`,
    runtime: "python3.13",
    resources: { vcpus: 1 },
    timeout: 60_000,
    persistent: false,
  });

  try {
    const command = await sandbox.runCommand("python", ["-c", "import sys; print(sys.version)"]);
    const stdout = (await command.stdout()).trim();
    const stderr = (await command.stderr()).trim();
    return NextResponse.json({
      ok: command.exitCode === 0,
      oidc: Boolean(process.env.VERCEL_OIDC_TOKEN),
      python: stdout,
      stderr,
    }, { status: command.exitCode === 0 ? 200 : 500 });
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}
