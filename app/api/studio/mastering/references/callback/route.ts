import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import {
  MEDIA_WORKER_CALLBACK_HASH_KEY,
  scheduleMediaWorkerSandboxCleanup,
} from "@/lib/media-worker/sandbox";
import { asMasteringClient } from "@/lib/mastering/jobs";
import { createServiceClient } from "@/lib/supabase/service";
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

function authorized(request: Request, state: Record<string, unknown>) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const token = authorization.slice(7);
  const expectedHash = state[MEDIA_WORKER_CALLBACK_HASH_KEY];
  if (typeof expectedHash !== "string" || expectedHash.length !== 64) return false;
  const actualHash = createHash("sha256").update(token).digest("hex");
  return safeEqual(actualHash, expectedHash);
}

function cleanState(value: Record<string, unknown>) {
  const next = { ...value };
  delete next[MEDIA_WORKER_CALLBACK_HASH_KEY];
  return next;
}

function scheduleCleanup() {
  after(scheduleMediaWorkerSandboxCleanup());
}

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  const referenceId = typeof payload.job_id === "string" ? payload.job_id : "";
  const status = typeof payload.status === "string" ? payload.status : "";
  const result = record(payload.result);
  const callbackError = typeof payload.error === "string" ? payload.error : null;
  if (!referenceId || !["running", "completed", "failed"].includes(status)) {
    return NextResponse.json({ error: "Invalid callback" }, { status: 400 });
  }

  const service = createServiceClient();
  const db = asMasteringClient(service);
  const lookup = await db.from("mastering_references").select("*").eq("id", referenceId).single();
  if (lookup.error || !lookup.data) return NextResponse.json({ error: "Reference not found" }, { status: 404 });
  const reference = lookup.data;
  const state = record(reference.analysis_state);
  if (!authorized(request, state)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (["ready", "failed"].includes(reference.status)) {
    scheduleCleanup();
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (status === "running") {
    const update = await db.from("mastering_references").update({
      status: "running",
      analysis_state: json({ ...state, status: "running", started_at: new Date().toISOString() }),
      error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", reference.id).eq("owner_id", reference.owner_id);
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (status === "failed") {
    const update = await db.from("mastering_references").update({
      status: "failed",
      analysis_state: json({ ...cleanState(state), status: "failed", completed_at: new Date().toISOString() }),
      external_job_id: null,
      error: callbackError || "Reference analysis failed.",
      updated_at: new Date().toISOString(),
    }).eq("id", reference.id).eq("owner_id", reference.owner_id);
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 });
    scheduleCleanup();
    return NextResponse.json({ ok: true });
  }

  try {
    const musicMap = record(result.music_map);
    const sourceAudio = record(musicMap.source_audio);
    const sourceUrl = typeof sourceAudio.url === "string" ? sourceAudio.url : null;
    const sourceAssetId = typeof sourceAudio.media_asset_id === "string" ? sourceAudio.media_asset_id : null;
    if (!reference.audio_url || sourceUrl !== reference.audio_url) {
      throw new Error("Reference analysis belongs to a different audio source and was discarded.");
    }
    if (reference.media_asset_id && sourceAssetId && sourceAssetId !== reference.media_asset_id) {
      throw new Error("Reference analysis media lineage does not match the uploaded reference.");
    }

    const inspector = record(musicMap.mastering_inspector);
    const signature = record(inspector.reference_signature);
    if (!Object.keys(signature).length) throw new Error("Reference analysis returned no mastering signature.");
    const fingerprint = typeof sourceAudio.audio_sha256 === "string" ? sourceAudio.audio_sha256 : null;
    if (!fingerprint) throw new Error("Reference analysis returned no source fingerprint.");

    const update = await db.from("mastering_references").update({
      status: "ready",
      reference_signature: json(signature),
      source_fingerprint: fingerprint,
      analysis_state: json({
        ...cleanState(state),
        status: "ready",
        completed_at: new Date().toISOString(),
        inspector_schema: typeof inspector.schema === "string" ? inspector.schema : null,
      }),
      external_job_id: null,
      error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", reference.id).eq("owner_id", reference.owner_id).eq("active", true);
    if (update.error) throw new Error(update.error.message);

    scheduleCleanup();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reference analysis reconciliation failed.";
    const update = await db.from("mastering_references").update({
      status: "failed",
      analysis_state: json({ ...cleanState(state), status: "failed", completed_at: new Date().toISOString() }),
      external_job_id: null,
      error: message,
      updated_at: new Date().toISOString(),
    }).eq("id", reference.id).eq("owner_id", reference.owner_id);
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 });
    scheduleCleanup();
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

