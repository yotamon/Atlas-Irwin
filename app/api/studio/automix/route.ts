import { createHash, randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { asAutoMixClient, autoMixOutputPath, kickAutoMixQueue } from "@/lib/automix/jobs";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import type {
  AutoMixEnergyProfile,
  AutoMixOutputFormat,
  AutoMixPurpose,
  AutoMixTransitionStyle,
} from "@/types/automix-database";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PURPOSES = new Set<AutoMixPurpose>(["booking", "soundcloud", "journey", "peak_time", "warm_up", "discovery"]);
const ENERGY = new Set<AutoMixEnergyProfile>(["smooth", "dynamic", "peak"]);
const STYLES = new Set<AutoMixTransitionStyle>(["clean", "dj", "creative"]);
const FORMATS = new Set<AutoMixOutputFormat>(["mp3", "wav"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? value as T : fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const artistId = url.searchParams.get("artist")?.trim() || "";
  if (!artistId) return NextResponse.json({ error: "artist is required" }, { status: 400 });
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  const db = asAutoMixClient(supabase);
  const jobs = await db.from("automix_jobs")
    .select("*")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (jobs.error) return NextResponse.json({ error: jobs.error.message }, { status: 500 });
  const assetIds = (jobs.data ?? []).map((job) => job.output_asset_id).filter((id): id is string => Boolean(id));
  const assets = assetIds.length
    ? await supabase.from("media_assets").select("id,public_url,mime_type,duration_ms").eq("owner_id", user.id).in("id", assetIds)
    : { data: [], error: null };
  if (assets.error) return NextResponse.json({ error: assets.error.message }, { status: 500 });
  const assetById = new Map((assets.data ?? []).map((asset) => [asset.id, asset]));
  return NextResponse.json({
    jobs: (jobs.data ?? []).map((job) => ({
      ...job,
      output: job.output_asset_id ? assetById.get(job.output_asset_id) ?? null : null,
    })),
  });
}

export async function POST(request: Request) {
  const body = record(await request.json().catch(() => null));
  const artistId = typeof body.artistId === "string" ? body.artistId.trim() : "";
  const trackIds = Array.isArray(body.trackIds)
    ? body.trackIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
    : [];
  if (!artistId) return NextResponse.json({ error: "artistId is required" }, { status: 400 });
  if (trackIds.length < 2 || trackIds.length > 20 || new Set(trackIds).size !== trackIds.length) {
    return NextResponse.json({ error: "Choose 2-20 unique tracks." }, { status: 400 });
  }
  if (trackIds.some((id) => !UUID_RE.test(id))) {
    return NextResponse.json({ error: "Every selected track id must be a valid UUID." }, { status: 400 });
  }

  const purpose = enumValue(body.purpose, PURPOSES, "booking");
  const energyProfile = enumValue(body.energyProfile, ENERGY, "dynamic");
  const transitionStyle = enumValue(body.transitionStyle, STYLES, "dj");
  const outputFormat = enumValue(body.outputFormat, FORMATS, "mp3");
  const durationMsRaw = typeof body.durationMs === "number" && Number.isFinite(body.durationMs)
    ? Math.round(body.durationMs)
    : 20 * 60 * 1000;
  const durationMs = Math.max(90_000, Math.min(60 * 60 * 1000, durationMsRaw));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "AutoMix";

  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  const music = asArtistScopedMusicClient(supabase);
  const tracks = await music.from("tracks")
    .select("id,title,audio_url")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .in("id", trackIds);
  if (tracks.error) return NextResponse.json({ error: tracks.error.message }, { status: 500 });
  const trackById = new Map((tracks.data ?? []).map((track) => [track.id, track]));
  const invalid = trackIds.find((id) => !trackById.get(id)?.audio_url);
  if (invalid) return NextResponse.json({ error: "Every selected track must have a canonical master." }, { status: 400 });

  const jobId = randomUUID();
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const idempotencyKey = createHash("sha256").update(JSON.stringify({
    owner: user.id,
    artist: artist.artistId,
    trackIds,
    purpose,
    energyProfile,
    transitionStyle,
    outputFormat,
    durationMs,
    minuteBucket,
  })).digest("hex");
  const partialJob = { owner_id: user.id, artist_id: artist.artistId, id: jobId, output_format: outputFormat };
  const outputPath = autoMixOutputPath(partialJob);
  const db = asAutoMixClient(supabase);
  const inserted = await db.from("automix_jobs").insert({
    id: jobId,
    owner_id: user.id,
    artist_id: artist.artistId,
    name,
    purpose,
    energy_profile: energyProfile,
    transition_style: transitionStyle,
    output_format: outputFormat,
    target_duration_ms: durationMs,
    track_ids: trackIds,
    source_fingerprints: json([]),
    status: "planned",
    idempotency_key: idempotencyKey,
    output_bucket: "public-media",
    output_path: outputPath,
    request_payload: json({ name, purpose, energy_profile: energyProfile, transition_style: transitionStyle, duration_ms: durationMs, output_format: outputFormat }),
    result_payload: json({}),
  }).select("*").single();

  if (inserted.error) {
    if (inserted.error.code === "23505") {
      const existing = await db.from("automix_jobs").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
      if (existing.data) return NextResponse.json({ job: existing.data, duplicate: true }, { status: 202 });
    }
    return NextResponse.json({ error: inserted.error.message }, { status: 500 });
  }

  after(async () => {
    await kickAutoMixQueue().catch(() => undefined);
  });
  return NextResponse.json({ job: inserted.data }, { status: 202 });
}
