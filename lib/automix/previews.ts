import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchMediaWorkerJob } from "@/lib/media-worker/dispatcher";
import {
  createMediaWorkerCallbackCredential,
  MEDIA_WORKER_CALLBACK_HASH_KEY,
} from "@/lib/media-worker/sandbox";
import { asStemClient } from "@/lib/music-intelligence/stem-scenes";
import { getSiteUrl } from "@/lib/site-url";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { createServiceClient } from "@/lib/supabase/service";
import { asAutoMixClient } from "@/lib/automix/jobs";
import type {
  AutoMixDatabase,
  AutoMixJob,
  AutoMixTransitionPreview,
} from "@/types/automix-database";
import type { Json } from "@/types/database";
import type { StemDatabase, TrackStem } from "@/types/stem-database";

const PREVIEW_BUCKET = "automix-previews";
const STALE_PREVIEW_MS = 20 * 60 * 1000;
const PREVIEW_PURGE_BATCH = 50;
const MAX_PREVIEW_PREPARATION_SKIPS = 8;

function json(value: unknown): Json {
  return value as Json;
}

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

function timestamp(value: unknown) {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function busyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already processing|worker is busy/i.test(message);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function withoutCredential(value: unknown) {
  const next = { ...record(value) };
  delete next[MEDIA_WORKER_CALLBACK_HASH_KEY];
  delete next.upload_url;
  delete next.tracks;
  delete next.mixplan;
  return next;
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

export function autoMixPreviewOutputPath(preview: Pick<AutoMixTransitionPreview, "owner_id" | "artist_id" | "automix_job_id" | "transition_index" | "id">) {
  return `automix/${preview.owner_id}/${preview.artist_id}/${preview.automix_job_id}/transition-${preview.transition_index}-${preview.id}.mp3`;
}

async function preparePreview(preview: AutoMixTransitionPreview) {
  const service = createServiceClient();
  const db = asAutoMixClient(service) as SupabaseClient<AutoMixDatabase>;
  const parentResult = await db.from("automix_jobs")
    .select("*")
    .eq("id", preview.automix_job_id)
    .eq("owner_id", preview.owner_id)
    .eq("artist_id", preview.artist_id)
    .single();
  if (parentResult.error || !parentResult.data) throw new Error(parentResult.error?.message || "Parent AutoMix session not found.");
  const parent = parentResult.data as AutoMixJob;
  if (parent.status !== "completed") throw new Error("Transition previews require a completed AutoMix session.");
  const parentPayload = record(parent.result_payload);
  const mixplan = record(parentPayload.render_manifest);
  const transitions = records(mixplan.transitions);
  const tracksInPlan = records(mixplan.tracks);
  if (!mixplan.plan_hash || preview.transition_index < 0 || preview.transition_index >= transitions.length) {
    throw new Error("The completed AutoMix session does not contain this verified transition.");
  }
  const left = tracksInPlan[preview.transition_index];
  const right = tracksInPlan[preview.transition_index + 1];
  const trackIds = [String(left?.track_id || ""), String(right?.track_id || "")];
  if (trackIds.some((id) => !id) || new Set(trackIds).size !== 2) {
    throw new Error("Verified transition lineage is incomplete.");
  }

  const musicDb = asArtistScopedMusicClient(service);
  const stemDb = asStemClient(service) as SupabaseClient<StemDatabase>;
  const [trackResult, intelligenceResult, stemResult] = await Promise.all([
    musicDb.from("tracks")
      .select("id,title,audio_url,artist_id,owner_id")
      .eq("owner_id", preview.owner_id)
      .eq("artist_id", preview.artist_id)
      .in("id", trackIds),
    stemDb.from("track_music_intelligence")
      .select("track_id,analysis,analysis_version,source_audio_url")
      .eq("owner_id", preview.owner_id)
      .in("track_id", trackIds),
    stemDb.from("track_stems")
      .select("*")
      .eq("owner_id", preview.owner_id)
      .in("track_id", trackIds)
      .eq("status", "ready"),
  ]);
  const firstError = trackResult.error || intelligenceResult.error || stemResult.error;
  if (firstError) throw new Error(firstError.message);

  const currentTrackById = new Map((trackResult.data ?? []).map((track) => [track.id, track]));
  const expectedFingerprints = new Map(
    (Array.isArray(parent.source_fingerprints) ? parent.source_fingerprints : [])
      .map((value) => record(value))
      .filter((value) => typeof value.track_id === "string")
      .map((value) => [String(value.track_id), String(value.audio_url || "")]),
  );
  for (const trackId of trackIds) {
    const current = currentTrackById.get(trackId);
    if (!current?.audio_url) throw new Error(`Transition source ${trackId} no longer has a canonical master.`);
    const expected = expectedFingerprints.get(trackId);
    if (!expected || expected !== current.audio_url) {
      throw new Error("A canonical master changed after this MixPlan was verified. Create a new AutoMix plan before previewing the transition.");
    }
  }

  const intelligenceByTrack = new Map((intelligenceResult.data ?? []).map((item) => [item.track_id, item]));
  const stemsByTrack = new Map<string, TrackStem[]>();
  for (const stem of (stemResult.data ?? []) as TrackStem[]) {
    const list = stemsByTrack.get(stem.track_id) ?? [];
    list.push(stem);
    stemsByTrack.set(stem.track_id, list);
  }
  const tracks = trackIds.map((trackId) => {
    const track = currentTrackById.get(trackId)!;
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
    return {
      id: track.id,
      title: track.title,
      audio_url: track.audio_url,
      music_map: mapIsCurrent ? map : {},
      stem_intelligence: stemIntelligence,
    };
  });

  const outputPath = preview.output_path || autoMixPreviewOutputPath(preview);
  const upload = await service.storage.from(preview.output_bucket || PREVIEW_BUCKET).createSignedUploadUrl(outputPath);
  if (upload.error || !upload.data?.signedUrl) {
    throw new Error(upload.error?.message || "Could not create a private transition-preview upload credential.");
  }
  return {
    outputPath,
    payload: {
      tracks,
      mixplan,
      transition_index: preview.transition_index,
      upload_url: upload.data.signedUrl,
      upload_bucket: preview.output_bucket || PREVIEW_BUCKET,
      upload_path: outputPath,
    },
  };
}

export async function purgeExpiredAutoMixPreviews() {
  const service = createServiceClient();
  const db = asAutoMixClient(service) as SupabaseClient<AutoMixDatabase>;
  const expired = await db.from("automix_transition_previews")
    .select("id,output_bucket,output_path")
    .eq("status", "completed")
    .is("purged_at", null)
    .lt("expires_at", new Date().toISOString())
    .order("expires_at")
    .limit(PREVIEW_PURGE_BATCH);
  if (expired.error) throw new Error(expired.error.message);

  let purged = 0;
  for (const row of expired.data ?? []) {
    const preview = row as Pick<AutoMixTransitionPreview, "id" | "output_bucket" | "output_path">;
    const removal = await service.storage
      .from(preview.output_bucket || PREVIEW_BUCKET)
      .remove([preview.output_path]);
    if (removal.error) continue;
    const update = await db.from("automix_transition_previews")
      .update({ purged_at: new Date().toISOString() })
      .eq("id", preview.id)
      .eq("status", "completed")
      .is("purged_at", null);
    if (!update.error) purged += 1;
  }
  return { inspected: expired.data?.length ?? 0, purged };
}

async function recoverStalePreviews(db: SupabaseClient<AutoMixDatabase>) {
  const active = await db.from("automix_transition_previews")
    .select("*")
    .in("status", ["queued", "running"])
    .order("created_at")
    .limit(20);
  if (active.error) throw new Error(active.error.message);
  let hasActive = false;
  for (const row of active.data ?? []) {
    const preview = row as AutoMixTransitionPreview;
    const last = timestamp(preview.started_at) || timestamp(preview.updated_at) || timestamp(preview.created_at);
    if (last && Date.now() - last < STALE_PREVIEW_MS) {
      hasActive = true;
      continue;
    }
    await db.from("automix_transition_previews").update({
      status: "failed",
      request_payload: json(withoutCredential(preview.request_payload)),
      error: "Transition preview became stale before a terminal callback was received.",
      completed_at: new Date().toISOString(),
    }).eq("id", preview.id).in("status", ["queued", "running"]);
  }
  return hasActive;
}

async function failPlannedPreviewPreparation(
  db: SupabaseClient<AutoMixDatabase>,
  preview: AutoMixTransitionPreview,
  error: unknown,
) {
  const message = errorMessage(error, "Transition preview could not be prepared for rendering.");
  const update = await db.from("automix_transition_previews").update({
    status: "failed",
    request_payload: json(withoutCredential(preview.request_payload)),
    error: message,
    completed_at: new Date().toISOString(),
  }).eq("id", preview.id)
    .eq("status", "planned")
    .select("id")
    .maybeSingle();
  if (update.error) throw new Error(update.error.message);
  return Boolean(update.data);
}

export async function kickAutoMixPreviewQueue() {
  const service = createServiceClient();
  const db = asAutoMixClient(service) as SupabaseClient<AutoMixDatabase>;
  await purgeExpiredAutoMixPreviews().catch(() => ({ inspected: 0, purged: 0 }));
  if (await recoverStalePreviews(db)) return { dispatched: false, busy: true };

  // A changed master, missing lineage or unavailable storage must not leave the oldest preview
  // permanently planned and block every later preview. Fail the poisoned row and keep walking.
  for (let attempt = 0; attempt < MAX_PREVIEW_PREPARATION_SKIPS; attempt += 1) {
    const planned = await db.from("automix_transition_previews")
      .select("*")
      .eq("status", "planned")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (planned.error) throw new Error(planned.error.message);
    if (!planned.data) return { dispatched: false, busy: false };
    const preview = planned.data as AutoMixTransitionPreview;

    let prepared: Awaited<ReturnType<typeof preparePreview>>;
    try {
      prepared = await preparePreview(preview);
    } catch (error) {
      await failPlannedPreviewPreparation(db, preview, error);
      continue;
    }

    const credential = createMediaWorkerCallbackCredential();
    const requestPayload = {
      ...prepared.payload,
      [MEDIA_WORKER_CALLBACK_HASH_KEY]: credential.hash,
    };
    const claimed = await db.from("automix_transition_previews").update({
      status: "queued",
      output_path: prepared.outputPath,
      request_payload: json(requestPayload),
      external_job_id: null,
      error: null,
      started_at: null,
      completed_at: null,
    }).eq("id", preview.id).eq("status", "planned").select("*").maybeSingle();
    if (claimed.error) throw new Error(claimed.error.message);
    if (!claimed.data) continue;

    try {
      const dispatch = await dispatchMediaWorkerJob({
        jobId: preview.id,
        jobType: "render_automix_preview",
        payload: requestPayload,
        callbackUrl: `${getSiteUrl()}/api/studio/automix/previews/callback`,
        callbackToken: credential.token,
      });
      const update = await db.from("automix_transition_previews")
        .update({ external_job_id: dispatch.sandboxName })
        .eq("id", preview.id);
      if (update.error) throw new Error(update.error.message);
      return { dispatched: true, busy: false };
    } catch (error) {
      if (busyError(error)) {
        await db.from("automix_transition_previews").update({
          status: "planned",
          request_payload: json(withoutCredential(preview.request_payload)),
          external_job_id: null,
          error: null,
        }).eq("id", preview.id);
        return { dispatched: false, busy: true };
      }
      const message = errorMessage(error, "Transition preview dispatch failed.");
      await db.from("automix_transition_previews").update({
        status: "failed",
        request_payload: json(withoutCredential(requestPayload)),
        error: message,
        completed_at: new Date().toISOString(),
      }).eq("id", preview.id);
      throw new Error(message);
    }
  }

  return { dispatched: false, busy: false };
}
