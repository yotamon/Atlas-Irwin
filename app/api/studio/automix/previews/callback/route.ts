import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { asAutoMixClient } from "@/lib/automix/jobs";
import {
  MEDIA_WORKER_CALLBACK_HASH_KEY,
  scheduleMediaWorkerSandboxCleanup,
} from "@/lib/media-worker/sandbox";
import { createServiceClient } from "@/lib/supabase/service";
import type { AutoMixTransitionPreview } from "@/types/automix-database";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function safeEqual(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: Request, requestPayload: Record<string, unknown>) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const token = authorization.slice(7);
  const expectedHash = requestPayload[MEDIA_WORKER_CALLBACK_HASH_KEY];
  if (typeof expectedHash !== "string" || expectedHash.length !== 64) return false;
  const actualHash = createHash("sha256").update(token).digest("hex");
  return safeEqual(actualHash, expectedHash);
}

function terminalRequestPayload(value: unknown) {
  const next = { ...record(value) };
  // Keep the one-way verifier for idempotent late callbacks; user-facing APIs never expose it.
  delete next.upload_url;
  delete next.tracks;
  delete next.mixplan;
  return next;
}

function scheduleCleanup() {
  after(scheduleMediaWorkerSandboxCleanup());
}

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  const previewId = typeof payload.job_id === "string" ? payload.job_id : "";
  const status = typeof payload.status === "string" ? payload.status : "";
  const result = record(payload.result);
  const callbackError = typeof payload.error === "string" ? payload.error : null;
  if (!previewId || !["running", "completed", "failed"].includes(status)) {
    return NextResponse.json({ error: "Invalid callback" }, { status: 400 });
  }

  const service = createServiceClient();
  const db = asAutoMixClient(service);
  const found = await db.from("automix_transition_previews").select("*").eq("id", previewId).single();
  if (found.error || !found.data) return NextResponse.json({ error: "Preview not found" }, { status: 404 });
  const preview = found.data as AutoMixTransitionPreview;
  const requestPayload = record(preview.request_payload);
  if (!authorized(request, requestPayload)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (["completed", "failed", "cancelled"].includes(preview.status)) {
    scheduleCleanup();
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (status === "running") {
    const previous = record(preview.result_payload);
    const merged = Object.keys(result).length ? { ...previous, ...result } : previous;
    const update = await db.from("automix_transition_previews").update({
      status: "running",
      result_payload: json(merged),
      started_at: preview.started_at || new Date().toISOString(),
      error: null,
    }).eq("id", preview.id)
      .in("status", ["queued", "running"])
      .select("id")
      .maybeSingle();
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, duplicate: !update.data });
  }

  if (status === "failed") {
    const update = await db.from("automix_transition_previews").update({
      status: "failed",
      request_payload: json(terminalRequestPayload(requestPayload)),
      result_payload: json(result),
      error: callbackError || "Transition preview worker job failed.",
      completed_at: new Date().toISOString(),
    }).eq("id", preview.id)
      .in("status", ["queued", "running"])
      .select("id")
      .maybeSingle();
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 });
    scheduleCleanup();
    return NextResponse.json({ ok: true, duplicate: !update.data });
  }

  const requestPath = typeof requestPayload.upload_path === "string" ? requestPayload.upload_path : preview.output_path;
  const requestBucket = typeof requestPayload.upload_bucket === "string" ? requestPayload.upload_bucket : preview.output_bucket;
  if (!requestPath || !requestBucket || result.uploaded !== true) {
    return NextResponse.json({ error: "Transition preview callback is missing private output lineage." }, { status: 409 });
  }

  const update = await db.from("automix_transition_previews").update({
    status: "completed",
    request_payload: json(terminalRequestPayload(requestPayload)),
    result_payload: json(result),
    error: null,
    completed_at: new Date().toISOString(),
  }).eq("id", preview.id)
    .in("status", ["queued", "running"])
    .select("id")
    .maybeSingle();
  if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 });
  if (!update.data) {
    scheduleCleanup();
    return NextResponse.json({ ok: true, duplicate: true });
  }

  scheduleCleanup();
  return NextResponse.json({ ok: true, private: true, expiresAt: preview.expires_at });
}
