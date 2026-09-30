import { handleFreeContentFactoryCallback } from "@/lib/marketing/free-content-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function POST(request: Request) {
  const body = record(await request.json().catch(() => ({})));
  const jobId = typeof body.job_id === "string" ? body.job_id : "";
  const status = typeof body.status === "string" ? body.status : "";
  const result = record(body.result);
  const callbackError = typeof body.error === "string" ? body.error : null;
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (!jobId || !["running", "completed", "failed"].includes(status)) {
    return Response.json({ error: "Invalid callback" }, { status: 400 });
  }

  try {
    const handled = await handleFreeContentFactoryCallback({
      jobId,
      status: status as "running" | "completed" | "failed",
      result,
      error: callbackError,
      token,
    });
    return Response.json(handled);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Content Factory callback failed.";
    const code = /unauthorized/i.test(message) ? 401 : /not found/i.test(message) ? 404 : 500;
    console.error("[content-factory-callback] callback failed", error);
    return Response.json({ error: message }, { status: code });
  }
}
