import { createHash, randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { asAutoMixClient, autoMixOutputPath, kickAutoMixQueue } from "@/lib/automix/jobs";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import type {
  AutoMixEnergyProfile,
  AutoMixJob,
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
const VARIANTS = new Set(["safe", "recommended", "adventurous"] as const);
const TECHNIQUES = new Set(["quick_mix", "bass_swap", "harmonic_blend", "breakdown_swap", "echo_out", "drop_cut"] as const);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PlanVariant = "safe" | "recommended" | "adventurous";
type ExecutionMode = "plan_only" | "approved_render";

type JobSettings = {
  name: string;
  purpose: AutoMixPurpose;
  energyProfile: AutoMixEnergyProfile;
  transitionStyle: AutoMixTransitionStyle;
  outputFormat: AutoMixOutputFormat;
  durationMs: number;
  trackIds: string[];
  setIntent: Record<string, unknown>;
  planDirectives: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : [];
}

function json(value: unknown): Json {
  return value as Json;
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? value as T : fallback;
}

function uniqueTrackIds(value: unknown, allowed?: Set<string>) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || (allowed && !allowed.has(id)) || result.includes(id)) continue;
    result.push(id);
  }
  return result;
}

function optionalBpm(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(60, Math.min(200, Math.round(value * 10) / 10));
}

function sanitizeSetIntent(value: unknown, trackIds: string[], purpose: AutoMixPurpose) {
  const raw = record(value);
  const allowed = new Set(trackIds);
  let mustPlayTrackIds = uniqueTrackIds(raw.mustPlayTrackIds ?? raw.must_play_track_ids, allowed);
  const blockedTrackIds = uniqueTrackIds(raw.blockedTrackIds ?? raw.blocked_track_ids, allowed);
  let minBpm = optionalBpm(raw.minBpm ?? raw.min_bpm);
  let maxBpm = optionalBpm(raw.maxBpm ?? raw.max_bpm);
  if (minBpm !== null && maxBpm !== null && minBpm > maxBpm) [minBpm, maxBpm] = [maxBpm, minBpm];
  const targetRaw = raw.targetTrackCount ?? raw.target_track_count;
  let targetTrackCount = typeof targetRaw === "number" && Number.isFinite(targetRaw)
    ? Math.max(2, Math.min(trackIds.length, Math.round(targetRaw)))
    : null;
  let allowOmissions = typeof (raw.allowOmissions ?? raw.allow_omissions) === "boolean"
    ? Boolean(raw.allowOmissions ?? raw.allow_omissions)
    : true;

  if (purpose === "journey") {
    allowOmissions = false;
    mustPlayTrackIds = [...trackIds];
    targetTrackCount = trackIds.length;
  }

  const conflict = mustPlayTrackIds.find((id) => blockedTrackIds.includes(id));
  if (conflict) throw new Error("A track cannot be both must-play and blocked.");
  return {
    version: "ensemblis.set-intent.v1",
    allow_omissions: allowOmissions,
    must_play_track_ids: mustPlayTrackIds,
    blocked_track_ids: blockedTrackIds,
    min_bpm: minBpm,
    max_bpm: maxBpm,
    target_track_count: targetTrackCount,
  };
}

function sanitizePlanDirectives(
  value: unknown,
  trackIds: string[],
  fallbackVariant: PlanVariant = "recommended",
) {
  const raw = record(value);
  const allowed = new Set(trackIds);
  const variant = enumValue(raw.variant, VARIANTS as Set<PlanVariant>, fallbackVariant);
  let preferred = uniqueTrackIds(
    raw.preferredOrderTrackIds ?? raw.preferred_order_track_ids,
    allowed,
  );
  if (!preferred.length) preferred = [...trackIds];
  preferred.push(...trackIds.filter((id) => !preferred.includes(id)));

  const lockedPositions: Array<{ track_id: string; position: number }> = [];
  const lockedTrackIds = new Set<string>();
  const lockedPositionValues = new Set<number>();
  for (const item of records(raw.lockedPositions ?? raw.locked_positions)) {
    const trackId = typeof (item.trackId ?? item.track_id) === "string"
      ? String(item.trackId ?? item.track_id).trim()
      : "";
    const positionRaw = item.position;
    if (!allowed.has(trackId)) throw new Error("A locked track must remain in the candidate pool.");
    if (typeof positionRaw !== "number" || !Number.isInteger(positionRaw) || positionRaw < 0 || positionRaw >= trackIds.length) {
      throw new Error("A locked position is outside the candidate-pool range.");
    }
    if (lockedTrackIds.has(trackId) || lockedPositionValues.has(positionRaw)) {
      throw new Error("Each locked track and set position must be unique.");
    }
    lockedTrackIds.add(trackId);
    lockedPositionValues.add(positionRaw);
    lockedPositions.push({ track_id: trackId, position: positionRaw });
  }
  lockedPositions.sort((a, b) => a.position - b.position);

  const transitionOverrides: Array<{ from_track_id: string; to_track_id: string; technique: string }> = [];
  const seenPairs = new Set<string>();
  for (const item of records(raw.transitionOverrides ?? raw.transition_overrides)) {
    const fromId = typeof (item.fromTrackId ?? item.from_track_id) === "string"
      ? String(item.fromTrackId ?? item.from_track_id).trim()
      : "";
    const toId = typeof (item.toTrackId ?? item.to_track_id) === "string"
      ? String(item.toTrackId ?? item.to_track_id).trim()
      : "";
    const technique = typeof item.technique === "string" ? item.technique : "";
    if (!allowed.has(fromId) || !allowed.has(toId) || fromId === toId) {
      throw new Error("A transition override must reference two different candidates.");
    }
    if (!TECHNIQUES.has(technique as never)) throw new Error("Unsupported transition override technique.");
    const pair = `${fromId}:${toId}`;
    if (seenPairs.has(pair)) throw new Error("A transition pair can only have one override.");
    seenPairs.add(pair);
    transitionOverrides.push({ from_track_id: fromId, to_track_id: toId, technique });
  }

  return {
    version: "ensemblis.plan-directives.v1",
    variant,
    preferred_order_track_ids: preferred,
    locked_positions: lockedPositions,
    transition_overrides: transitionOverrides,
  };
}

function planManifest(job: AutoMixJob) {
  const result = record(job.result_payload);
  const plan = record(result.plan);
  const nested = record(plan.render_manifest);
  const direct = record(result.render_manifest);
  const manifest = Object.keys(nested).length ? nested : direct;
  return typeof manifest.plan_hash === "string" && manifest.plan_hash.length === 64 ? manifest : null;
}

function lineageFromJob(job: AutoMixJob) {
  const request = record(job.request_payload);
  const lineage = record(request.plan_lineage);
  return {
    rootJobId: typeof lineage.root_job_id === "string" ? lineage.root_job_id : job.id,
    revision: typeof lineage.revision === "number" && Number.isInteger(lineage.revision)
      ? Math.max(1, lineage.revision)
      : 1,
  };
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function validateCatalogTracks(
  supabase: Awaited<ReturnType<typeof requireStudioAdmin>>["supabase"],
  ownerId: string,
  artistId: string,
  trackIds: string[],
) {
  if (trackIds.length < 2 || trackIds.length > 20 || new Set(trackIds).size !== trackIds.length) {
    throw new Error("Choose 2-20 unique tracks.");
  }
  if (trackIds.some((id) => !UUID_RE.test(id))) throw new Error("Every selected track must be valid.");
  const music = asArtistScopedMusicClient(supabase);
  const tracks = await music.from("tracks")
    .select("id,audio_url")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .in("id", trackIds);
  if (tracks.error) throw new Error("Could not validate the selected catalog tracks.");
  const byId = new Map((tracks.data ?? []).map((track) => [track.id, track]));
  if (trackIds.some((id) => !byId.get(id)?.audio_url)) {
    throw new Error("Every selected track must have a canonical master.");
  }
}

function settingsFromBody(body: Record<string, unknown>, artistName: string): JobSettings {
  const trackIds = uniqueTrackIds(body.trackIds);
  const purpose = enumValue(body.purpose, PURPOSES, "booking");
  const energyProfile = enumValue(body.energyProfile, ENERGY, "dynamic");
  const transitionStyle = enumValue(body.transitionStyle, STYLES, "dj");
  const outputFormat = enumValue(body.outputFormat, FORMATS, "mp3");
  const durationRaw = typeof body.durationMs === "number" && Number.isFinite(body.durationMs)
    ? Math.round(body.durationMs)
    : 20 * 60 * 1000;
  const durationMs = Math.max(90_000, Math.min(60 * 60 * 1000, durationRaw));
  const name = typeof body.name === "string" && body.name.trim()
    ? body.name.trim().slice(0, 120)
    : `${artistName} Set Plan`;
  const variant = enumValue(body.variant, VARIANTS as Set<PlanVariant>, "recommended");
  return {
    name,
    purpose,
    energyProfile,
    transitionStyle,
    outputFormat,
    durationMs,
    trackIds,
    setIntent: sanitizeSetIntent(body.setIntent, trackIds, purpose),
    planDirectives: sanitizePlanDirectives(body.planDirectives ?? { variant }, trackIds, variant),
  };
}

function settingsFromParent(parent: AutoMixJob, body: Record<string, unknown>): JobSettings {
  const parentRequest = record(parent.request_payload);
  const parentPlan = record(record(parent.result_payload).plan);
  const trackIds = Array.isArray(body.trackIds) ? uniqueTrackIds(body.trackIds) : [...parent.track_ids];
  const purpose = parent.purpose;
  const setIntentInput = body.setIntent ?? parentPlan.set_intent ?? parentRequest.set_intent;
  const directivesInput = body.planDirectives ?? parentPlan.plan_directives ?? parentRequest.plan_directives;
  const fallbackVariant = enumValue(
    record(directivesInput).variant,
    VARIANTS as Set<PlanVariant>,
    "recommended",
  );
  return {
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : parent.name,
    purpose,
    energyProfile: parent.energy_profile,
    transitionStyle: parent.transition_style,
    outputFormat: parent.output_format,
    durationMs: parent.target_duration_ms,
    trackIds,
    setIntent: sanitizeSetIntent(setIntentInput, trackIds, purpose),
    planDirectives: sanitizePlanDirectives(directivesInput, trackIds, fallbackVariant),
  };
}

async function insertJob({
  db,
  ownerId,
  artistId,
  settings,
  executionMode,
  lineage,
  approvedMixplan,
  idempotencyKey,
}: {
  db: ReturnType<typeof asAutoMixClient>;
  ownerId: string;
  artistId: string;
  settings: JobSettings;
  executionMode: ExecutionMode;
  lineage: Record<string, unknown>;
  approvedMixplan?: Record<string, unknown> | null;
  idempotencyKey: string;
}) {
  const jobId = randomUUID();
  const partial = { owner_id: ownerId, artist_id: artistId, id: jobId, output_format: settings.outputFormat };
  const outputPath = autoMixOutputPath(partial);
  const payload: Record<string, unknown> = {
    name: settings.name,
    purpose: settings.purpose,
    energy_profile: settings.energyProfile,
    transition_style: settings.transitionStyle,
    duration_ms: settings.durationMs,
    output_format: settings.outputFormat,
    set_intent: settings.setIntent,
    plan_directives: settings.planDirectives,
    plan_lineage: lineage,
    execution_mode: executionMode,
  };
  if (approvedMixplan) payload.approved_mixplan = approvedMixplan;

  const inserted = await db.from("automix_jobs").insert({
    id: jobId,
    owner_id: ownerId,
    artist_id: artistId,
    name: settings.name,
    purpose: settings.purpose,
    energy_profile: settings.energyProfile,
    transition_style: settings.transitionStyle,
    output_format: settings.outputFormat,
    target_duration_ms: settings.durationMs,
    track_ids: settings.trackIds,
    source_fingerprints: json([]),
    status: "planned",
    idempotency_key: idempotencyKey,
    output_bucket: "public-media",
    output_path: outputPath,
    request_payload: json(payload),
    result_payload: json({ phase: executionMode === "plan_only" ? "planning_queued" : "render_queued" }),
  }).select("*").single();

  if (!inserted.error) return { job: inserted.data, duplicate: false };
  if (inserted.error.code === "23505") {
    const existing = await db.from("automix_jobs").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existing.data) return { job: existing.data, duplicate: true };
  }
  throw new Error("Could not create the Set Builder job.");
}

export async function POST(request: Request) {
  try {
    const body = record(await request.json().catch(() => null));
    const action = typeof body.action === "string" ? body.action : "create";
    const artistId = typeof body.artistId === "string" ? body.artistId.trim() : "";
    if (!UUID_RE.test(artistId)) return NextResponse.json({ error: "A valid artist is required." }, { status: 400 });

    const { supabase, user } = await requireStudioAdmin();
    const artist = await resolveArtistContext(supabase, user, artistId);
    const db = asAutoMixClient(supabase);

    if (action === "create") {
      const settings = settingsFromBody(body, artist.artistName);
      await validateCatalogTracks(supabase, user.id, artist.artistId, settings.trackIds);
      const jobIdSeed = randomUUID();
      const lineage = {
        version: "ensemblis.plan-lineage.v1",
        root_job_id: jobIdSeed,
        parent_job_id: null,
        revision: 1,
        operation: "create",
      };
      const minuteBucket = Math.floor(Date.now() / 60_000);
      const idempotencyKey = stableHash({
        owner: user.id,
        artist: artist.artistId,
        action,
        settings,
        minuteBucket,
      });
      // insertJob generates the durable row ID, so the root identity is corrected to that ID below
      // through a stable pre-insert lineage seed that never leaks into later revisions.
      const created = await insertJob({
        db,
        ownerId: user.id,
        artistId: artist.artistId,
        settings,
        executionMode: "plan_only",
        lineage,
        idempotencyKey,
      });
      if (!created.duplicate && created.job?.id) {
        const correctedLineage = { ...lineage, root_job_id: created.job.id };
        await db.from("automix_jobs").update({
          request_payload: json({ ...record(created.job.request_payload), plan_lineage: correctedLineage }),
        }).eq("id", created.job.id).eq("owner_id", user.id).eq("status", "planned");
      }
      after(async () => { await kickAutoMixQueue().catch(() => undefined); });
      return NextResponse.json({ job: created.job, duplicate: created.duplicate }, { status: 202 });
    }

    const parentId = typeof body.parentJobId === "string" ? body.parentJobId.trim() : "";
    if (!UUID_RE.test(parentId)) return NextResponse.json({ error: "A valid parent plan is required." }, { status: 400 });
    const parentResult = await db.from("automix_jobs")
      .select("*")
      .eq("id", parentId)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .maybeSingle();
    if (parentResult.error) throw new Error(parentResult.error.message);
    if (!parentResult.data) return NextResponse.json({ error: "Set plan not found." }, { status: 404 });
    const parent = parentResult.data as AutoMixJob;
    const manifest = planManifest(parent);
    if (parent.status !== "completed" || !manifest) {
      return NextResponse.json({ error: "Only a completed verified plan can be revised, compared or rendered." }, { status: 409 });
    }
    const parentLineage = lineageFromJob(parent);

    if (action === "derive") {
      const settings = settingsFromParent(parent, body);
      await validateCatalogTracks(supabase, user.id, artist.artistId, settings.trackIds);
      const operation = typeof body.operation === "string" && body.operation.trim()
        ? body.operation.trim().slice(0, 80)
        : "edit";
      const lineage = {
        version: "ensemblis.plan-lineage.v1",
        root_job_id: parentLineage.rootJobId,
        parent_job_id: parent.id,
        revision: parentLineage.revision + 1,
        operation,
      };
      const minuteBucket = Math.floor(Date.now() / 60_000);
      const idempotencyKey = stableHash({
        owner: user.id,
        parent: parent.id,
        action,
        operation,
        settings,
        minuteBucket,
      });
      const created = await insertJob({
        db,
        ownerId: user.id,
        artistId: artist.artistId,
        settings,
        executionMode: "plan_only",
        lineage,
        idempotencyKey,
      });
      after(async () => { await kickAutoMixQueue().catch(() => undefined); });
      return NextResponse.json({ job: created.job, duplicate: created.duplicate }, { status: 202 });
    }

    if (action === "alternatives") {
      const baseSettings = settingsFromParent(parent, body);
      await validateCatalogTracks(supabase, user.id, artist.artistId, baseSettings.trackIds);
      const comparisonGroupId = randomUUID();
      const jobs = [];
      for (const variant of ["safe", "recommended", "adventurous"] as PlanVariant[]) {
        const settings = {
          ...baseSettings,
          planDirectives: { ...baseSettings.planDirectives, variant },
        };
        const lineage = {
          version: "ensemblis.plan-lineage.v1",
          root_job_id: parentLineage.rootJobId,
          parent_job_id: parent.id,
          revision: parentLineage.revision + 1,
          operation: "alternative",
          comparison_group_id: comparisonGroupId,
          variant,
        };
        const idempotencyKey = stableHash({
          owner: user.id,
          parent: parent.id,
          action,
          comparisonGroupId,
          variant,
          settings,
        });
        const created = await insertJob({
          db,
          ownerId: user.id,
          artistId: artist.artistId,
          settings,
          executionMode: "plan_only",
          lineage,
          idempotencyKey,
        });
        jobs.push(created.job);
      }
      after(async () => { await kickAutoMixQueue().catch(() => undefined); });
      return NextResponse.json({ jobs, comparisonGroupId }, { status: 202 });
    }

    if (action === "render") {
      const settings = settingsFromParent(parent, body);
      await validateCatalogTracks(supabase, user.id, artist.artistId, settings.trackIds);
      const planHash = String(manifest.plan_hash);
      const lineage = {
        version: "ensemblis.plan-lineage.v1",
        root_job_id: parentLineage.rootJobId,
        parent_job_id: parent.id,
        revision: parentLineage.revision,
        operation: "approve_render",
        approved_plan_hash: planHash,
      };
      const idempotencyKey = stableHash({
        owner: user.id,
        artist: artist.artistId,
        action,
        parent: parent.id,
        planHash,
        outputFormat: settings.outputFormat,
      });
      const created = await insertJob({
        db,
        ownerId: user.id,
        artistId: artist.artistId,
        settings,
        executionMode: "approved_render",
        lineage,
        approvedMixplan: manifest,
        idempotencyKey,
      });
      after(async () => { await kickAutoMixQueue().catch(() => undefined); });
      return NextResponse.json({ job: created.job, duplicate: created.duplicate }, { status: 202 });
    }

    return NextResponse.json({ error: "Unsupported Set Builder action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the Set Builder plan.";
    const clientError = /Choose |valid|locked|transition|must-play|blocked|candidate|Unsupported|canonical master/i.test(message);
    return NextResponse.json({ error: message }, { status: clientError ? 400 : 500 });
  }
}
