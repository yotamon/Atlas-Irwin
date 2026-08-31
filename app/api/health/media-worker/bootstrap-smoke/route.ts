import { NextResponse } from "next/server";
import { Sandbox } from "@vercel/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sandbox = await Sandbox.create({
    image: "vercel/sandbox/universal",
    resources: { vcpus: 1 },
    timeout: 60_000,
    persistent: false,
  });

  try {
    const command = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", `set -e
printf 'python='; command -v python3
python3 --version
python3 - <<'PY'
import bz2
import lzma
import sqlite3
import ssl
print('SYSTEM_LIBS_READY')
print('bz2', bz2.__file__)
PY
printf 'pip='; command -v pip3 || true
printf 'uv='; command -v uv || true
python3 -m ensurepip --version || true`],
    });
    const stdout = await command.stdout();
    const stderr = await command.stderr();
    return NextResponse.json({
      ok: command.exitCode === 0 && stdout.includes("SYSTEM_LIBS_READY"),
      exitCode: command.exitCode,
      stdout,
      stderr,
      image: sandbox.image,
    }, { status: command.exitCode === 0 ? 200 : 500 });
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}
