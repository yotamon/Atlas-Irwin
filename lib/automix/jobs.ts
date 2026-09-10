import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hybridDeviceSnapshot,
  normalizeHybridCandidateSnapshot,
} from "@/lib/automix/hybrid-candidates";
import {
  asDjIntelligenceClient,
  plannerDjProfile,
} from "@/lib/automix/personalization";
import {
  candidateIdsFromSnapshot,
  normalizeDeviceCandidateSnapshot,
  workerTracksFromSnapshot,
} from "@/lib/automix/source-candidates";
import { dispatchMediaWorkerJob } from "@/lib/media-worker/dispatcher";
import {
  createMediaWorkerCallbackCredential,
  MEDIA_WORKER_CALLBACK_HASH_KEY,
} from "@/lib/media-worker/sandbox";
import { asStemClient } from "@/lib/music-intelligence/stem-scenes";
import { getSiteUrl } from "@/lib/site-url";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { createServiceClient } from "@/lib/supabase/service";
import type { AutoMixDatabase, AutoMixJob } from "@/types/automix-database";
import type { Database, Json } from "@/types/database";
import type { StemDatabase, TrackStem } from "@/types/stem-database";

const AUTOMIX_BUCKET = "public-media";
const STALE_JOB_MS = 50 * 60 * 1000;
const MAX_PREPARATION_SKIPS = 8;

type PreparedPayload = {
  payload: Record<string, unknown>;
  outputPath: string;
  publicUrl: string;
  fingerprints: Record<string, unknown>[];
};

export function asAutoMixClient(client: SupabaseClient<Database> | SupabaseClient<AutoMixDatabase>) {
  return client as unknown as SupabaseClient<AutoMixDatabase>;
}

function json(value: unknown): Json {
  return value as Json;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function timestamp(value: unknown) {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function withoutCredential(value: Record<string, unknown>) {
  const next = { ...value };
  delete next[MEDIA_WORKER_CALLBACK_HASH_KEY];
  delete next.upload_url;
  delete next.tracks;
  return next;
}

function busyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already processing|worker is busy/i.test(message);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function autoMixOutputPath(job: Pick<AutoMixJob, "owner_id" | "artist_id" | "id" | "output_format">) {
  return `automix/${job.owner_id}/${job.artist_id}/${job.id}.${job.output_format}`;
}

function sourceUrlFromMap(value: unknown) {
  const map = record(value);
  const source = record(map.source_audio);
  return typeof source.url === "string" ? source.url : "";
}

function bestStemByCategory(stems: TrackStem[], category: "vocals" | "bass") {
  return stems
    .filter((stem) => stem.category === category && stem.status === "ready")
    .sort((a, b) => Number(b.alignment_confidence ?? 0) - Number(a.alignment_confidence ?? 0))[0] ?? null;
}

function executionMode(job: AutoMixJob) {
  const value = record(job.request_payload).execution_mode;
  return typeof value === "string" ? value : "render";
}

async function prepareCatalogPayload(job: AutoMixJob): Promise<PreparedPayload> {
  const service = createServiceClient();
  const musicDb = asArtistScopedMusicClient(service);
  const stemDb = asStemClient(service) as SupabaseClient<StemDatabase>;
  const djDb = asDjIntelligenceClient(service);
  const [trackResult, intelligenceResult, stemResult, djProfileResult] = await Promise.all([
    musicDb.from("tracks")
      .select("id,title,audio_url,artist_id,owner_id")
      .eq("owner_id", job.owner_id)
      .eq("artist_id", job.artist_id)
      .in("id", job.track_ids),
    stemDb.from("track_music_intelligence")
      .select("track_id,analysis,analysis_version,source_audio_url")
      .eq("owner_id", job.owner_id)
      .in("track_id", job.track_ids),
    stemDb.from("track_stems")
      .select("*")
      .eq("owner_id", job.owner_id)
      .in("track_id", job.track_ids)
      .eq("status", "ready"),
    djDb.from("dj_profiles")
      .select("*")
      .eq("owner_id", job.owner_id)
      .eq("artist_id", job.artist_id)
      .maybeSingle(),
  ]);
  const firstError = trackResult.error || intelligenceResult.error || stemResult.error || djProfileResult.error;
  if (firstError) throw new Error(firstError.message);

  const trackById = new Map((trackResult.data ?? []).map((track) => [track.id, track]));
  const intelligenceByTrack = new Map((intelligenceResult.data ?? []).map((item) => [item.track_id, item]));
  const stemsByTrack = new Map<string, TrackStem[]>();
  for (const stem of (stemResult.data ?? []) as TrackStem[]) {
    const list = stemsByTrack.get(stem.track_id) ?? [];
    list.push(stem);
    stemsByTrack.set(stem.track_id, list);
  }

  const tracks: Record<string, unknown>[] = [];
  const fingerprints: Record<string, unknown>[] = [];
  for (const trackId of job.track_ids) {
    const track = trackById.get(trackId);
    if (!track?.audio_url) throw new Error(`Track ${trackId} has no canonical master.`);
    const intelligence = intelligenceByTrack.get(trackId);
    const map = record(intelligence?.analysis);
    const intelligenceSource = intelligence?.source_audio_url || sourceUrlFromMap(map);
    const mapIsCurrent = Boolean(intelligenceSource && intelligenceSource === track.audio_url);
    const currentStems = (stemsByTrack.get(trackId) ?? []).filter((stem) => stem.source_master_url === track.audio_url);
    const vocals = bestStemByCategory(currentStems, "vocals");
    const bass = bestStemByCategory(currentStems, "bass");
    const stemIntelligence: Record<string, unknown> = {};
    if (vocals) stemIntelligence.vocals = vocals.analysis;
    if (bass) stemIntelligence.bass = bass.analysis;

    tracks.push({
      id: track.id,
      title: track.title,
      audio_url: track.audio_url,
      music_map: mapIsCurrent ? map : {},
      stem_intelligence: stemIntelligence,
    });
    fingerprints.push({
      track_id: track.id,
      audio_url: track.audio_url,
      music_analysis_version: mapIsCurrent ? intelligence?.analysis_version ?? null : null,
      music_analysis_current: mapIsCurrent,
      vocal_stem_id: vocals?.id ?? null,
      bass_stem_id: bass?.id ?? null,
    });
  }

  const outputPath = job.output_path || autoMixOutputPath(job);
  const base = withoutCredential(record(job.request_payload));
  const baseIntent = record(base.set_intent);
  const journey = job.purpose === "journey";
  const setIntent = {
    ...baseIntent,
    version: "ensemblis.set-intent.v1",
    allow_omissions: journey ? false : baseIntent.allow_omissions !== false,
    must_play_track_ids: journey ? [...job.track_ids] : baseIntent.must_play_track_ids,
    target_track_count: journey ? job.track_ids.length : baseIntent.target_track_count,
  };
  const payload: Record<string, unknown> = {
    ...base,
    tracks,
    purpose: job.purpose,
    energy_profile: job.energy_profile,
    transition_style: job.transition_style,
    duration_ms: job.target_duration_ms,
    output_format: job.output_format,
    set_intent: setIntent,
    dj_profile: plannerDjProfile(djProfileResult.data),
  };

  let publicUrl = "";
  if (executionMode(job) !== "plan_only") {
    const upload = await service.storage.from(job.output_bucket || AUTOMIX_BUCKET).createSignedUploadUrl(outputPath);
    if (upload.error || !upload.data?.signedUrl) {
      throw new Error(upload.error?.message || "Could not create AutoMix upload credential.");
    }
    publicUrl = service.storage.from(job.output_bucket || AUTOMIX_BUCKET).getPublicUrl(outputPath).data.publicUrl;
    payload.upload_url = upload.data.signedUrl;
    payload.upload_bucket = job.output_bucket || AUTOMIX_BUCKET;
    payload.upload_path = outputPath;
    payload.public_url = publicUrl;
  }

  return { payload, outputPath, publicUrl, fingerprints };
}

async function prepareDevicePlanningPayload(job: AutoMixJob): Promise<PreparedPayload> {
  const request = record(job.request_payload);
  const snapshotValue = request.candidate_snapshot;
  const snapshot = normalizeDeviceCandidateSnapshot(snapshotValue);
  if (!snapshot) throw new Error("Device AutoMix candidate snapshot is invalid or incomplete.");
  if (executionMode(job) !== "plan_only") {
    throw new Error("Device AutoMix rendering must execute through the paired Library Bridge.");
  }
  if (job.track_ids.length > 0) {
    throw new Error("Device AutoMix jobs cannot contain catalog track IDs unless a hybrid snapshot is present.");
  }

  const service = createServiceClient();
  const djDb = asDjIntelligenceClient(service);
  const djProfileResult = await djDb.from("dj_profiles")
    .select("*")
    .eq("owner_id", job.owner_id)
    .eq("artist_id", job.artist_id)
    .maybeSingle();
  if (djProfileResult.error) throw new Error(djProfileResult.error.message);

  const ids = candidateIdsFromSnapshot(snapshot);
  const base = withoutCredential(request);
  const baseIntent = record(base.set_intent);
  const journey = job.purpose === "journey";
  const setIntent = {
    ...baseIntent,
    version: "ensemblis.set-intent.v1",
    allow_omissions: journey ? false : baseIntent.allow_omissions !== false,
    must_play_track_ids: journey ? ids : baseIntent.must_play_track_ids,
    target_track_count: journey ? ids.length : baseIntent.target_track_count,
  };

  return {
    payload: {
      ...base,
      tracks: workerTracksFromSnapshot(snapshot),
      purpose: job.purpose,
      energy_profile: job.energy_profile,
      transition_style: job.transition_style,
      duration_ms: job.target_duration_ms,
      output_format: job.output_format,
      set_intent: setIntent,
      dj_profile: plannerDjProfile(djProfileResult.data),
    },
    outputPath: job.output_path || autoMixOutputPath(job),
    publicUrl: "",
    fingerprints: [],
  };
}

async function prepareHybridPlanningPayload(job: AutoMixJob): Promise<PreparedPayload> {
  const request = record(job.request_payload);
  const snapshot = normalizeHybridCandidateSnapshot(request.candidate_snapshot);
  if (!snapshot) throw new Error("Hybrid AutoMix candidate snapshot is invalid or incomplete.");
  if (executionMode(job) !== "plan_only") {
    throw new Error("Hybrid MixPlans must render through the paired Library Bridge.");
  }
  if (
    job.track_ids.length !== snapshot.catalogTrackIds.length
    || job.track_ids.some((id) => !snapshot.catalogTrackIds.includes(id))
  ) throw new Error("Hybrid catalog identities no longer match the durable candidate snapshot.");

  const catalog = await prepareCatalogPayload(job);
  const catalogTracks = Array.isArray(catalog.payload.tracks)
    ? catalog.payload.tracks.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const deviceTracks = workerTracksFromSnapshot(hybridDeviceSnapshot(snapshot));
  const byId = new Map<string, Record<string, unknown>>();
  for (const track of catalogTracks) {
    const id = typeof track.id === "string" ? track.id : "";
    if (id) byId.set(id, { ...track, execution_target: "cloud" });
  }
  for (const track of deviceTracks) byId.set(String(track.id), track);
  const tracks = snapshot.candidateOrder.map((id) => byId.get(id));
  if (tracks.some((track) => !track)) throw new Error("Hybrid candidate evidence is incomplete.");

  const base = { ...catalog.payload };
  delete base.upload_url;
  delete base.upload_bucket;
  delete base.upload_path;
  delete base.public_url;
  const baseIntent = record(base.set_intent);
  const journey = job.purpose === "journey";
  return {
    payload: {
      ...base,
      execution_target: "hybrid_device",
      tracks: tracks as Record<string, unknown>[],
      set_intent: {
        ...baseIntent,
        version: "ensemblis.set-intent.v1",
        allow_omissions: journey ? false : baseIntent.allow_omissions !== false,
        must_play_track_ids: journey ? [...snapshot.candidateOrder] : baseIntent.must_play_track_ids,
        target_track_count: journey ? snapshot.candidateOrder.length : baseIntent.target_track_count,
      },
    },
    outputPath: job.output_path || autoMixOutputPath(job),
    publicUrl: "",
    fingerprints: catalog.fingerprints,
  };
}

async function prepareJobPayload(job: AutoMixJob): Promise<PreparedPayload> {
  const request = record(job.request_payload);
  if (normalizeHybridCandidateSnapshot(request.candidate_snapshot)) return prepareHybridPlanningPayload(job);
  if (request.candidate_snapshot !== undefined) return prepareDevicePlanningPayload(job);
  return prepareCatalogPayload(job);
}

async function recoverStaleJobs(db: SupabaseClient<AutoMixDatabase>) {
  const active = await db.from("automix_jobs")
    .select("*")
    .in("status", ["queued", "running"])
    .order("created_at")
    .limit(20);
  if (active.error) throw new Error(active.error.message);
  let hasActive = false;
  for (const row of active.data ?? []) {
    const job = row as AutoMixJob;
    const last = timestamp(job.started_at) || timestamp(job.updated_at) || timestamp(job.created_at);
    if (last && Date.now() - last < STALE_JOB_MS) {
      hasActive = true;
      continue;
    }
    await db.from("automix_jobs").update({
      status: "failed",
      request_payload: json(withoutCredential(record(job.request_payload))),
      error: "AutoMix job became stale before a terminal callback was received.",
      completed_at: new Date().toISOString(),
    }).eq("id", job.id).in("status", ["queued", "running"]);
  }
  return hasActive;
}

async function failPlannedPreparation(
  db: SupabaseClient<AutoMixDatabase>,
  job: AutoMixJob,
  error: unknown,
) {
  const message = errorMessage(error, "AutoMix could not prepare this session for rendering.");
  const update = await db.from("automix_jobs").update({
    status: "failed",
    request_payload: json(withoutCredential(record(job.request_payload))),
    error: message,
    completed_at: new Date().toISOString(),
  }).eq("id", job.id)
    .eq("status", "planned")
    .select("id")
    .maybeSingle();
  if (update.error) throw new Error(update.error.message);
  return Boolean(update.data);
}

export async function kickAutoMixQueue() {
  const service = createServiceClient();
  const db = asAutoMixClient(service);
  if (await recoverStaleJobs(db)) return { dispatched: false, busy: true };

  for (let attempt = 0; attempt < MAX_PREPARATION_SKIPS; attempt += 1) {
    const planned = await db.from("automix_jobs")
      .select("*")
      .eq("status", "planned")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (planned.error) throw new Error(planned.error.message);
    if (!planned.data) return { dispatched: false, busy: false };
    const job = planned.data as AutoMixJob;

    let prepared: PreparedPayload;
    try {
      prepared = await prepareJobPayload(job);
    } catch (error) {
      const failed = await failPlannedPreparation(db, job, error);
      if (!failed) continue;
      continue;
    }

    const credential = createMediaWorkerCallbackCredential();
    const requestPayload = {
      ...prepared.payload,
      [MEDIA_WORKER_CALLBACK_HASH_KEY]: credential.hash,
    };

    const claimed = await db.from("automix_jobs").update({
      status: "queued",
      source_fingerprints: json(prepared.fingerprints),
      request_payload: json(requestPayload),
      output_path: prepared.outputPath,
      error: null,
      external_job_id: null,
      started_at: null,
      completed_at: null,
    }).eq("id", job.id).eq("status", "planned").select("*").maybeSingle();
    if (claimed.error) throw new Error(claimed.error.message);
    if (!claimed.data) continue;

    try {
      const dispatch = await dispatchMediaWorkerJob({
        jobId: job.id,
        jobType: "render_automix",
        payload: requestPayload,
        callbackUrl: `${getSiteUrl()}/api/studio/automix/callback`,
        callbackToken: credential.token,
      });
      const update = await db.from("automix_jobs").update({ external_job_id: dispatch.sandboxName }).eq("id", job.id);
      if (update.error) throw new Error(update.error.message);
      return { dispatched: true, busy: false };
    } catch (error) {
      if (busyError(error)) {
        await db.from("automix_jobs").update({
          status: "planned",
          request_payload: json(withoutCredential(record(job.request_payload))),
          external_job_id: null,
          error: null,
        }).eq("id", job.id);
        return { dispatched: false, busy: true };
      }
      const message = errorMessage(error, "AutoMix dispatch failed.");
      await db.from("automix_jobs").update({
        status: "failed",
        request_payload: json(withoutCredential(requestPayload)),
        error: message,
        completed_at: new Date().toISOString(),
      }).eq("id", job.id);
      throw new Error(message);
    }
  }

  return { dispatched: false, busy: false };
}
