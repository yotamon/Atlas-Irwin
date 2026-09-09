import { createHash, randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { asAutoMixClient } from "@/lib/automix/jobs";
import { autoMixPreviewOutputPath, kickAutoMixPreviewQueue } from "@/lib/automix/previews";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext } from "@/lib/studio/artist-context";
import { createServiceClient } from "@/lib/supabase/service";
import type { AutoMixJob, AutoMixTransitionPreview } from "@/types/automix-database";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREVIEW_BUCKET = "automix-previews";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function json(value: unknown): Json {
  return value as Json;
}

function isFresh(preview: Pick<AutoMixTransitionPreview, "expires_at">) {
  const expires = Date.parse(preview.expires_at);
  return Number.isFinite(expires) && expires > Date.now();
}

async function signedPreview(preview: AutoMixTransitionPreview) {
  if (preview.status !== "completed" || !isFresh(preview)) return { ...preview, preview_url: null };
  const service = createServiceClient();
  const signed = await service.storage
    .from(preview.output_bucket || PREVIEW_BUCKET)
    .createSignedUrl(preview.output_path, 15 * 60);
  return {
    ...preview,
    preview_url: signed.error ? null : signed.data?.signedUrl ?? null,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const artistId = url.searchParams.get("artist")?.trim() || "";
  const jobId = url.searchParams.get("job")?.trim() || "";
  if (!UUID_RE.test(artistId) || !UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "A valid artist and AutoMix session are required." }, { status: 400 });
  }
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  const db = asAutoMixClient(supabase);
  const previews = await db.from("automix_transition_previews")
    .select("*")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .eq("automix_job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (previews.error) return NextResponse.json({ error: "Could not load transition previews." }, { status: 500 });
  const latestByTransition = new Map<number, AutoMixTransitionPreview>();
  for (const row of previews.data ?? []) {
    const preview = row as AutoMixTransitionPreview;
    if (!latestByTransition.has(preview.transition_index)) latestByTransition.set(preview.transition_index, preview);
  }
  return NextResponse.json({
    previews: await Promise.all([...latestByTransition.values()].map(signedPreview)),
  });
}

export async function POST(request: Request) {
  const body = record(await request.json().catch(() => null));
  const artistId = typeof body.artistId === "string" ? body.artistId.trim() : "";
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const transitionIndex = typeof body.transitionIndex === "number" && Number.isInteger(body.transitionIndex)
    ? body.transitionIndex
    : -1;
  if (!UUID_RE.test(artistId) || !UUID_RE.test(jobId) || transitionIndex < 0 || transitionIndex >= 20) {
    return NextResponse.json({ error: "A valid artist, AutoMix session and transition are required." }, { status: 400 });
  }

  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  const db = asAutoMixClient(supabase);
  const parentResult = await db.from("automix_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (parentResult.error) return NextResponse.json({ error: "Could not load the AutoMix session." }, { status: 500 });
  if (!parentResult.data) return NextResponse.json({ error: "AutoMix session not found." }, { status: 404 });
  const parent = parentResult.data as AutoMixJob;
  if (parent.status !== "completed") {
    return NextResponse.json({ error: "Transition previews are available after the verified mix has completed." }, { status: 409 });
  }
  const manifest = record(record(parent.result_payload).render_manifest);
  const transitions = records(manifest.transitions);
  if (!manifest.plan_hash || transitionIndex >= transitions.length) {
    return NextResponse.json({ error: "This session does not contain that verified transition." }, { status: 409 });
  }

  const existing = await db.from("automix_transition_previews")
    .select("*")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .eq("automix_job_id", jobId)
    .eq("transition_index", transitionIndex)
    .in("status", ["planned", "queued", "running", "completed"])
    .order("created_at", { ascending: false })
    .limit(5);
  if (existing.error) return NextResponse.json({ error: "Could not inspect existing transition previews." }, { status: 500 });
  const reusable = (existing.data ?? [])
    .map((row) => row as AutoMixTransitionPreview)
    .find((preview) => preview.status !== "completed" || isFresh(preview));
  if (reusable) {
    return NextResponse.json({ preview: await signedPreview(reusable), duplicate: true }, { status: 202 });
  }

  const previewId = randomUUID();
  const partial = {
    id: previewId,
    owner_id: user.id,
    artist_id: artist.artistId,
    automix_job_id: jobId,
    transition_index: transitionIndex,
  };
  const outputPath = autoMixPreviewOutputPath(partial);
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  const idempotencyKey = createHash("sha256").update(JSON.stringify({
    ownerId: user.id,
    jobId,
    transitionIndex,
    planHash: manifest.plan_hash,
    bucket,
  })).digest("hex");
  const inserted = await db.from("automix_transition_previews").insert({
    ...partial,
    status: "planned",
    idempotency_key: idempotencyKey,
    output_bucket: PREVIEW_BUCKET,
    output_path: outputPath,
    request_payload: json({
      parent_mixplan_hash: manifest.plan_hash,
      transition_index: transitionIndex,
    }),
    result_payload: json({ phase: "queued" }),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }).select("*").single();
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      const active = await db.from("automix_transition_previews")
        .select("*")
        .eq("owner_id", user.id)
        .eq("automix_job_id", jobId)
        .eq("transition_index", transitionIndex)
        .in("status", ["planned", "queued", "running"])
        .maybeSingle();
      if (active.data) return NextResponse.json({ preview: active.data, duplicate: true }, { status: 202 });
    }
    return NextResponse.json({ error: "Could not create the transition preview." }, { status: 500 });
  }

  after(async () => {
    await kickAutoMixPreviewQueue().catch(() => undefined);
  });
  return NextResponse.json({ preview: inserted.data }, { status: 202 });
}
