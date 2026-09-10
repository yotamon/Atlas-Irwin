import { createHash, randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import {
  assertHybridDeviceSourcesStillAvailable,
  hybridCandidateIds,
  normalizeHybridCandidateSnapshot,
  resolveHybridCandidateSnapshot,
  type HybridCandidateSnapshot,
} from "@/lib/automix/hybrid-candidates";
import { asAutoMixClient, autoMixOutputPath, kickAutoMixQueue } from "@/lib/automix/jobs";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  assertPathFree,
  createDjLibraryServiceClient,
  jsonByteLength,
} from "@/lib/dj-library/device-server";
import { resolveArtistContext } from "@/lib/studio/artist-context";
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
const FINGERPRINT_RE = /^sha256:[0-9a-f]{64}$/i;
const MIXPLAN_VERSION = "ensemblis.mixplan.v2";
const HYBRID_RENDER_JOB_VERSION = "ensemblis.library-bridge.render-job.v2";

type PlanVariant = "safe" | "recommended" | "adventurous";
type HybridPlanSettings = {
  name: string;
  purpose: AutoMixPurpose;
  energyProfile: AutoMixEnergyProfile;
  transitionStyle: AutoMixTransitionStyle;
  outputFormat: AutoMixOutputFormat;
  durationMs: number;
  setIntent: Record<string, unknown>;
  planDirectives: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function records(value: unknown) { return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length) : []; }
function json(value: unknown): Json { return value as Json; }
function enumValue<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === "string" && allowed.has(value as T) ? value as T : fallback;
}
function stableHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function uniqueCandidateIds(value: unknown, allowed: Set<string>) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id && allowed.has(id) && !result.includes(id)) result.push(id);
  }
  return result;
}

function optionalBpm(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(60, Math.min(200, Math.round(value * 10) / 10));
}

function sanitizeSetIntent(value: unknown, candidateIds: string[], purpose: AutoMixPurpose) {
  const raw = record(value);
  const allowed = new Set(candidateIds);
  let mustPlay = uniqueCandidateIds(raw.mustPlayTrackIds ?? raw.must_play_track_ids, allowed);
  const blocked = uniqueCandidateIds(raw.blockedTrackIds ?? raw.blocked_track_ids, allowed);
  let minBpm = optionalBpm(raw.minBpm ?? raw.min_bpm);
  let maxBpm = optionalBpm(raw.maxBpm ?? raw.max_bpm);
  if (minBpm !== null && maxBpm !== null && minBpm > maxBpm) [minBpm, maxBpm] = [maxBpm, minBpm];
  const targetRaw = raw.targetTrackCount ?? raw.target_track_count;
  let targetTrackCount = typeof targetRaw === "number" && Number.isFinite(targetRaw)
    ? Math.max(2, Math.min(candidateIds.length, Math.round(targetRaw)))
    : null;
  let allowOmissions = typeof (raw.allowOmissions ?? raw.allow_omissions) === "boolean"
    ? Boolean(raw.allowOmissions ?? raw.allow_omissions)
    : true;
  if (purpose === "journey") {
    allowOmissions = false;
    mustPlay = [...candidateIds];
    targetTrackCount = candidateIds.length;
  }
  if (mustPlay.some((id) => blocked.includes(id))) throw new Error("A hybrid track cannot be both must-play and blocked.");
  return {
    version: "ensemblis.set-intent.v1",
    allow_omissions: allowOmissions,
    must_play_track_ids: mustPlay,
    blocked_track_ids: blocked,
    min_bpm: minBpm,
    max_bpm: maxBpm,
    target_track_count: targetTrackCount,
  };
}

function sanitizePlanDirectives(value: unknown, candidateIds: string[], fallback: PlanVariant) {
  const raw = record(value);
  const allowed = new Set(candidateIds);
  const variant = enumValue(raw.variant, VARIANTS as Set<PlanVariant>, fallback);
  let preferred = uniqueCandidateIds(raw.preferredOrderTrackIds ?? raw.preferred_order_track_ids, allowed);
  if (!preferred.length) preferred = [...candidateIds];
  preferred.push(...candidateIds.filter((id) => !preferred.includes(id)));
  const lockedPositions: Array<{ track_id: string; position: number }> = [];
  const seenTracks = new Set<string>();
  const seenPositions = new Set<number>();
  for (const item of records(raw.lockedPositions ?? raw.locked_positions)) {
    const trackId = typeof (item.trackId ?? item.track_id) === "string" ? String(item.trackId ?? item.track_id).trim() : "";
    const position = item.position;
    if (!allowed.has(trackId)) throw new Error("A locked hybrid track must remain in the candidate pool.");
    if (typeof position !== "number" || !Number.isInteger(position) || position < 0 || position >= candidateIds.length) {
      throw new Error("A locked position is outside the hybrid candidate-pool range.");
    }
    if (seenTracks.has(trackId) || seenPositions.has(position)) throw new Error("Each locked hybrid track and set position must be unique.");
    seenTracks.add(trackId); seenPositions.add(position); lockedPositions.push({ track_id: trackId, position });
  }
  lockedPositions.sort((a, b) => a.position - b.position);
  const transitionOverrides: Array<{ from_track_id: string; to_track_id: string; technique: string }> = [];
  const seenPairs = new Set<string>();
  for (const item of records(raw.transitionOverrides ?? raw.transition_overrides)) {
    const fromId = typeof (item.fromTrackId ?? item.from_track_id) === "string" ? String(item.fromTrackId ?? item.from_track_id).trim() : "";
    const toId = typeof (item.toTrackId ?? item.to_track_id) === "string" ? String(item.toTrackId ?? item.to_track_id).trim() : "";
    const technique = typeof item.technique === "string" ? item.technique : "";
    if (!allowed.has(fromId) || !allowed.has(toId) || fromId === toId) throw new Error("A hybrid transition override must reference two different candidates.");
    if (!TECHNIQUES.has(technique as never)) throw new Error("Unsupported transition override technique.");
    const pair = `${fromId}:${toId}`;
    if (seenPairs.has(pair)) throw new Error("A hybrid transition pair can only have one override.");
    seenPairs.add(pair); transitionOverrides.push({ from_track_id: fromId, to_track_id: toId, technique });
  }
  return {
    version: "ensemblis.plan-directives.v1",
    variant,
    preferred_order_track_ids: preferred,
    locked_positions: lockedPositions,
    transition_overrides: transitionOverrides,
  };
}

function settings(body: Record<string, unknown>, artistName: string, snapshot: HybridCandidateSnapshot, fallback?: HybridPlanSettings): HybridPlanSettings {
  const ids = hybridCandidateIds(snapshot);
  const purpose = enumValue(body.purpose, PURPOSES, fallback?.purpose ?? "booking");
  const energyProfile = enumValue(body.energyProfile, ENERGY, fallback?.energyProfile ?? "dynamic");
  const transitionStyle = enumValue(body.transitionStyle, STYLES, fallback?.transitionStyle ?? "dj");
  const outputFormat = enumValue(body.outputFormat, FORMATS, fallback?.outputFormat ?? "mp3");
  const durationRaw = typeof body.durationMs === "number" && Number.isFinite(body.durationMs) ? Math.round(body.durationMs) : fallback?.durationMs ?? 20 * 60 * 1000;
  const durationMs = Math.max(90_000, Math.min(60 * 60 * 1000, durationRaw));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : fallback?.name ?? `${artistName} Hybrid Set Plan`;
  const variant = enumValue(body.variant, VARIANTS as Set<PlanVariant>, "recommended");
  return {
    name,
    purpose,
    energyProfile,
    transitionStyle,
    outputFormat,
    durationMs,
    setIntent: sanitizeSetIntent(body.setIntent ?? fallback?.setIntent, ids, purpose),
    planDirectives: sanitizePlanDirectives(body.planDirectives ?? fallback?.planDirectives ?? { variant }, ids, variant),
  };
}

function settingsFromParent(parent: AutoMixJob, snapshot: HybridCandidateSnapshot, body: Record<string, unknown>) {
  const request = record(parent.request_payload);
  const resultPlan = record(record(parent.result_payload).plan);
  return settings(body, parent.name, snapshot, {
    name: parent.name,
    purpose: parent.purpose,
    energyProfile: parent.energy_profile,
    transitionStyle: parent.transition_style,
    outputFormat: parent.output_format,
    durationMs: parent.target_duration_ms,
    setIntent: record(resultPlan.set_intent ?? request.set_intent),
    planDirectives: record(resultPlan.plan_directives ?? request.plan_directives),
  });
}

function lineage(job: AutoMixJob) {
  const value = record(record(job.request_payload).plan_lineage);
  return {
    rootJobId: typeof value.root_job_id === "string" ? value.root_job_id : job.id,
    revision: typeof value.revision === "number" && Number.isInteger(value.revision) ? Math.max(1, value.revision) : 1,
  };
}

function planManifest(job: AutoMixJob) {
  const result = record(job.result_payload);
  const plan = record(result.plan);
  const nested = record(plan.render_manifest);
  const direct = record(result.render_manifest);
  const manifest = Object.keys(nested).length ? nested : direct;
  return manifest.version === MIXPLAN_VERSION && typeof manifest.plan_hash === "string" && manifest.plan_hash.length === 64 ? manifest : null;
}

function manifestSourceRows(manifest: Record<string, unknown>) {
  return records(record(manifest.provenance).source_fingerprints);
}

function validateHybridManifest(manifest: Record<string, unknown>, snapshot: HybridCandidateSnapshot) {
  const planTracks = records(manifest.tracks);
  const rows = manifestSourceRows(manifest);
  if (!planTracks.length || rows.length !== planTracks.length) throw new Error("Hybrid MixPlan provenance is incomplete.");
  const deviceById = new Map(snapshot.deviceCandidates.map((candidate) => [candidate.candidateId, candidate]));
  const catalog = new Set(snapshot.catalogTrackIds);
  const rowById = new Map(rows.map((row) => [String(row.track_id ?? ""), row]));
  for (const track of planTracks) {
    const id = typeof track.track_id === "string" ? track.track_id : "";
    const row = rowById.get(id);
    if (!id || !row) throw new Error("Hybrid MixPlan contains an unverified source identity.");
    const device = deviceById.get(id);
    if (device) {
      if (
        row.execution_target !== "device"
        || row.source_kind !== device.source.kind
        || row.source_id !== device.source.librarySourceId
        || row.source_track_id !== device.source.trackId
        || row.recording_fingerprint !== device.source.recordingFingerprint
      ) throw new Error("Hybrid MixPlan local provenance no longer matches the frozen candidate snapshot.");
    } else if (catalog.has(id)) {
      if (row.execution_target !== "cloud" || row.source_kind !== "artist_catalog" || !FINGERPRINT_RE.test(String(row.recording_fingerprint ?? "")) || typeof row.audio_url !== "string") {
        throw new Error("Hybrid MixPlan catalog provenance is incomplete.");
      }
    } else {
      throw new Error("Hybrid MixPlan references a track outside the durable candidate snapshot.");
    }
  }
  return { planTracks, rowById, deviceById };
}

async function insertPlanJob({ db, ownerId, artistId, snapshot, planSettings, planLineage, idempotencyKey, requestedJobId }: {
  db: ReturnType<typeof asAutoMixClient>;
  ownerId: string;
  artistId: string;
  snapshot: HybridCandidateSnapshot;
  planSettings: HybridPlanSettings;
  planLineage: Record<string, unknown>;
  idempotencyKey: string;
  requestedJobId?: string;
}) {
  const jobId = requestedJobId ?? randomUUID();
  const outputPath = autoMixOutputPath({ owner_id: ownerId, artist_id: artistId, id: jobId, output_format: planSettings.outputFormat });
  const payload = {
    name: planSettings.name,
    purpose: planSettings.purpose,
    energy_profile: planSettings.energyProfile,
    transition_style: planSettings.transitionStyle,
    duration_ms: planSettings.durationMs,
    output_format: planSettings.outputFormat,
    execution_mode: "plan_only",
    execution_target: "hybrid_device",
    candidate_snapshot: snapshot,
    set_intent: planSettings.setIntent,
    plan_directives: planSettings.planDirectives,
    plan_lineage: planLineage,
  };
  assertPathFree(payload, "hybrid plan");
  if (jsonByteLength(payload) > 2 * 1024 * 1024) throw new Error("Hybrid candidate evidence is too large for one Set Plan.");
  const inserted = await db.from("automix_jobs").insert({
    id: jobId,
    owner_id: ownerId,
    artist_id: artistId,
    name: planSettings.name,
    purpose: planSettings.purpose,
    energy_profile: planSettings.energyProfile,
    transition_style: planSettings.transitionStyle,
    output_format: planSettings.outputFormat,
    target_duration_ms: planSettings.durationMs,
    track_ids: snapshot.catalogTrackIds,
    source_fingerprints: json([]),
    status: "planned",
    idempotency_key: idempotencyKey,
    output_bucket: "public-media",
    output_path: outputPath,
    request_payload: json(payload),
    result_payload: json({ phase: "planning_queued", execution_target: "hybrid_device" }),
  }).select("*").single();
  if (!inserted.error) return { job: inserted.data, duplicate: false };
  if (inserted.error.code === "23505") {
    const existing = await db.from("automix_jobs").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existing.data) return { job: existing.data, duplicate: true };
  }
  throw new Error("Could not create the hybrid Set Builder job.");
}

async function parentJob(db: ReturnType<typeof asAutoMixClient>, ownerId: string, artistId: string, id: string) {
  if (!UUID_RE.test(id)) throw new Error("A valid parent hybrid plan is required.");
  const result = await db.from("automix_jobs").select("*").eq("id", id).eq("owner_id", ownerId).eq("artist_id", artistId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Hybrid Set Plan not found.");
  const job = result.data as AutoMixJob;
  const snapshot = normalizeHybridCandidateSnapshot(record(job.request_payload).candidate_snapshot);
  if (!snapshot) throw new Error("The parent plan is not a valid hybrid Set Plan.");
  return { job, snapshot };
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
      const snapshot = await resolveHybridCandidateSnapshot({ ownerId: user.id, artistId: artist.artistId, requested: body.candidateRefs });
      const planSettings = settings(body, artist.artistName, snapshot);
      const jobId = randomUUID();
      const planLineage = { version: "ensemblis.plan-lineage.v1", root_job_id: jobId, parent_job_id: null, revision: 1, operation: "create_hybrid" };
      const created = await insertPlanJob({
        db, ownerId: user.id, artistId: artist.artistId, snapshot, planSettings, planLineage,
        idempotencyKey: stableHash({ owner: user.id, artist: artist.artistId, action, snapshot, planSettings, minute: Math.floor(Date.now() / 60_000) }),
        requestedJobId: jobId,
      });
      after(async () => { await kickAutoMixQueue().catch(() => undefined); });
      return NextResponse.json({ job: created.job, duplicate: created.duplicate }, { status: 202 });
    }

    const parentId = typeof body.parentJobId === "string" ? body.parentJobId.trim() : "";
    const parent = await parentJob(db, user.id, artist.artistId, parentId);

    if (action === "render") {
      if (parent.job.status !== "completed") throw new Error("Only a completed hybrid Set Plan can be rendered.");
      const manifest = planManifest(parent.job);
      if (!manifest) throw new Error("The hybrid Set Plan has no verified frozen MixPlan.");
      const verified = validateHybridManifest(manifest, parent.snapshot);
      const deviceId = await assertHybridDeviceSourcesStillAvailable({ ownerId: user.id, artistId: artist.artistId, snapshot: parent.snapshot });
      const planSettings = settingsFromParent(parent.job, parent.snapshot, body);
      const selectedCatalogIds = verified.planTracks
        .map((track) => String(track.track_id ?? ""))
        .filter((id) => parent.snapshot.catalogTrackIds.includes(id));
      const catalogRows = selectedCatalogIds.length
        ? await supabase.from("tracks").select("id,title,audio_url").eq("owner_id", user.id).eq("artist_id", artist.artistId).in("id", selectedCatalogIds)
        : { data: [], error: null };
      if (catalogRows.error || (catalogRows.data?.length ?? 0) !== selectedCatalogIds.length) throw new Error("A catalog master selected by this hybrid MixPlan is unavailable.");
      const catalogById = new Map((catalogRows.data ?? []).map((track) => [track.id, track]));
      for (const id of selectedCatalogIds) {
        const row = verified.rowById.get(id);
        const track = catalogById.get(id);
        if (!row || !track?.audio_url || row.audio_url !== track.audio_url) throw new Error("A catalog master changed after this hybrid MixPlan was frozen. Replan before rendering.");
      }

      const parentLineage = lineage(parent.job);
      const planHash = String(manifest.plan_hash);
      const renderJobId = randomUUID();
      const renderLineage = {
        version: "ensemblis.plan-lineage.v1",
        root_job_id: parentLineage.rootJobId,
        parent_job_id: parent.job.id,
        revision: parentLineage.revision,
        operation: "approve_hybrid_render",
        approved_plan_hash: planHash,
        approved_plan_job_id: parent.job.id,
      };
      const outputPath = autoMixOutputPath({ owner_id: user.id, artist_id: artist.artistId, id: renderJobId, output_format: planSettings.outputFormat });
      const requestPayload = {
        name: planSettings.name,
        purpose: planSettings.purpose,
        energy_profile: planSettings.energyProfile,
        transition_style: planSettings.transitionStyle,
        duration_ms: planSettings.durationMs,
        output_format: planSettings.outputFormat,
        execution_mode: "approved_render",
        execution_target: "hybrid_device",
        candidate_snapshot: parent.snapshot,
        approved_mixplan: manifest,
        set_intent: planSettings.setIntent,
        plan_directives: planSettings.planDirectives,
        plan_lineage: renderLineage,
      };
      assertPathFree(requestPayload, "hybrid render request");
      const renderIdempotency = stableHash({ owner: user.id, artist: artist.artistId, action, parent: parent.job.id, planHash, outputFormat: planSettings.outputFormat });
      const renderInsert = await db.from("automix_jobs").insert({
        id: renderJobId,
        owner_id: user.id,
        artist_id: artist.artistId,
        name: planSettings.name,
        purpose: planSettings.purpose,
        energy_profile: planSettings.energyProfile,
        transition_style: planSettings.transitionStyle,
        output_format: planSettings.outputFormat,
        target_duration_ms: planSettings.durationMs,
        track_ids: selectedCatalogIds,
        source_fingerprints: json(selectedCatalogIds.map((id) => verified.rowById.get(id)).filter(Boolean)),
        status: "queued",
        idempotency_key: renderIdempotency,
        output_bucket: "device-local",
        output_path: outputPath,
        request_payload: json(requestPayload),
        result_payload: json({ phase: "hybrid_device_render_queued", execution_target: "hybrid_device", plan: { ...manifest, render_manifest: manifest } }),
      }).select("*").single();
      if (renderInsert.error) {
        if (renderInsert.error.code === "23505") {
          const existing = await db.from("automix_jobs").select("*").eq("idempotency_key", renderIdempotency).maybeSingle();
          if (existing.data) return NextResponse.json({ job: existing.data, duplicate: true }, { status: 202 });
        }
        throw new Error("Could not create the approved hybrid render.");
      }

      const selectedCandidates = verified.planTracks.map((planTrack) => {
        const id = String(planTrack.track_id ?? "");
        const provenance = verified.rowById.get(id);
        if (!provenance) throw new Error("Hybrid MixPlan source provenance is incomplete.");
        const device = verified.deviceById.get(id);
        if (device) {
          return {
            candidateId: id,
            title: typeof planTrack.title === "string" ? planTrack.title : (typeof device.metadata.title === "string" ? device.metadata.title : "Untitled"),
            executionTarget: "device",
            sourceKind: device.source.kind,
            sourceId: device.source.librarySourceId,
            sourceTrackId: device.source.trackId,
            recordingFingerprint: device.source.recordingFingerprint,
          };
        }
        const catalog = catalogById.get(id);
        if (!catalog?.audio_url) throw new Error("Hybrid catalog source URL is unavailable.");
        return {
          candidateId: id,
          title: typeof planTrack.title === "string" ? planTrack.title : catalog.title,
          executionTarget: "cloud",
          sourceKind: "artist_catalog",
          sourceUrl: catalog.audio_url,
          recordingFingerprint: provenance.recording_fingerprint,
        };
      });
      const jobPayload = {
        version: HYBRID_RENDER_JOB_VERSION,
        automixJobId: renderJobId,
        planHash,
        outputFormat: planSettings.outputFormat,
        mixPlan: manifest,
        candidates: selectedCandidates,
      };
      assertPathFree(jobPayload, "hybrid render device job");
      if (jsonByteLength(jobPayload) > 4 * 1024 * 1024) {
        await db.from("automix_jobs").update({ status: "failed", error: "Hybrid render evidence exceeded the device-job safety budget.", completed_at: new Date().toISOString() }).eq("id", renderJobId);
        throw new Error("Hybrid render evidence is too large for one device job.");
      }
      const deviceClient = createDjLibraryServiceClient();
      const deviceInsert = await deviceClient.from("dj_library_device_jobs").insert({
        device_id: deviceId,
        owner_id: user.id,
        artist_id: artist.artistId,
        automix_job_id: renderJobId,
        idempotency_key: `automix-hybrid-render:${renderJobId}:${planHash}`,
        job_type: "render_mixplan",
        source_revision: planHash,
        payload: json(jobPayload),
        status: "queued",
      });
      if (deviceInsert.error) {
        await db.from("automix_jobs").update({ status: "failed", error: "Could not queue the hybrid MixPlan on the paired computer.", completed_at: new Date().toISOString() }).eq("id", renderJobId);
        throw new Error("Could not queue the hybrid MixPlan on the paired computer.");
      }
      return NextResponse.json({ job: renderInsert.data, duplicate: false, executionTarget: "hybrid_device" }, { status: 202 });
    }

    if (parent.job.status !== "completed" || !planManifest(parent.job)) throw new Error("Only a completed verified hybrid plan can be revised or compared.");
    const snapshot = body.candidateRefs !== undefined
      ? await resolveHybridCandidateSnapshot({ ownerId: user.id, artistId: artist.artistId, requested: body.candidateRefs })
      : parent.snapshot;
    const planSettings = settingsFromParent(parent.job, snapshot, body);
    const parentLineage = lineage(parent.job);

    if (action === "derive") {
      const operation = typeof body.operation === "string" && body.operation.trim() ? body.operation.trim().slice(0, 80) : "edit_hybrid";
      const planLineage = { version: "ensemblis.plan-lineage.v1", root_job_id: parentLineage.rootJobId, parent_job_id: parent.job.id, revision: parentLineage.revision + 1, operation };
      const created = await insertPlanJob({
        db, ownerId: user.id, artistId: artist.artistId, snapshot, planSettings, planLineage,
        idempotencyKey: stableHash({ owner: user.id, parent: parent.job.id, action, operation, snapshot, planSettings, minute: Math.floor(Date.now() / 60_000) }),
      });
      after(async () => { await kickAutoMixQueue().catch(() => undefined); });
      return NextResponse.json({ job: created.job, duplicate: created.duplicate }, { status: 202 });
    }

    if (action === "alternatives") {
      const groupId = randomUUID();
      const jobs = [];
      for (const variant of ["safe", "recommended", "adventurous"] as PlanVariant[]) {
        const variantSettings: HybridPlanSettings = { ...planSettings, planDirectives: { ...planSettings.planDirectives, variant } };
        const planLineage = {
          version: "ensemblis.plan-lineage.v1", root_job_id: parentLineage.rootJobId, parent_job_id: parent.job.id,
          revision: parentLineage.revision + 1, operation: "hybrid_alternative", comparison_group_id: groupId, variant,
        };
        const created = await insertPlanJob({
          db, ownerId: user.id, artistId: artist.artistId, snapshot, planSettings: variantSettings, planLineage,
          idempotencyKey: stableHash({ owner: user.id, parent: parent.job.id, action, groupId, variant, snapshot, variantSettings }),
        });
        jobs.push(created.job);
      }
      after(async () => { await kickAutoMixQueue().catch(() => undefined); });
      return NextResponse.json({ jobs, comparisonGroupId: groupId }, { status: 202 });
    }

    return NextResponse.json({ error: "Unsupported hybrid Set Builder action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the hybrid Set Builder plan.";
    const clientError = /Choose |valid|locked|transition|must-play|blocked|candidate|Library Bridge|hybrid|catalog|MixPlan|paired computer|Unsupported|changed after/i.test(message);
    return NextResponse.json({ error: message }, { status: clientError ? 400 : 500 });
  }
}
