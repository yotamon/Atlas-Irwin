import "server-only";

import { activeCapabilitiesForOwner } from "@/lib/licensing/capabilities";
import { dispatchMediaWorkerJob } from "@/lib/media-worker/dispatcher";
import {
  isMediaWorkerBusyError,
  isMediaWorkerCapacityError,
  mediaWorkerCapacityBlocked,
  mediaWorkerCapacityErrorMessage,
  mediaWorkerCapacityRetryAfter,
} from "@/lib/media-worker/failures";
import {
  createMediaWorkerCallbackCredential,
  MEDIA_WORKER_CALLBACK_HASH_KEY,
} from "@/lib/media-worker/sandbox";
import { asMasteringClient } from "@/lib/mastering/jobs";
import { getSiteUrl } from "@/lib/site-url";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";
import type { MasteringReference } from "@/types/mastering-database";

const STALE_REFERENCE_MS = 50 * 60 * 1000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function withoutCredential(value: Record<string, unknown>) {
  const next = { ...value };
  delete next[MEDIA_WORKER_CALLBACK_HASH_KEY];
  return next;
}

function timestamp(value: unknown) {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function recoverStaleReference(reference: MasteringReference) {
  const lastActivity = timestamp(reference.updated_at) || timestamp(reference.created_at);
  if (!lastActivity || Date.now() - lastActivity < STALE_REFERENCE_MS) return false;
  const service = createServiceClient();
  const db = asMasteringClient(service);
  const state = withoutCredential(record(reference.analysis_state));
  const update = await db.from("mastering_references").update({
    status: "pending",
    analysis_state: json({ ...state, status: "pending", recovered_at: new Date().toISOString() }),
    external_job_id: null,
    error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", reference.id).eq("owner_id", reference.owner_id).in("status", ["queued", "running"]);
  if (update.error) throw new Error(update.error.message);
  return true;
}

export async function kickMasteringReferenceQueue() {
  const service = createServiceClient();
  const db = asMasteringClient(service);

  const active = await db.from("mastering_references")
    .select("*")
    .eq("kind", "uploaded_reference")
    .eq("active", true)
    .in("status", ["queued", "running"])
    .order("updated_at")
    .limit(1)
    .maybeSingle();
  if (active.error) throw new Error(active.error.message);
  if (active.data) {
    const recovered = await recoverStaleReference(active.data as MasteringReference);
    if (!recovered) return { dispatched: false, busy: true, reason: "busy" as const };
  }

  const pending = await db.from("mastering_references")
    .select("*")
    .eq("kind", "uploaded_reference")
    .eq("active", true)
    .eq("status", "pending")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (pending.error) throw new Error(pending.error.message);
  if (!pending.data) return { dispatched: false, busy: false, reason: "empty" as const };

  const reference = pending.data as MasteringReference;
  const capacity = mediaWorkerCapacityBlocked(reference.error);
  if (capacity.blocked) {
    return {
      dispatched: false,
      busy: false,
      reason: "capacity" as const,
      retryAt: capacity.retryAfter,
    };
  }
  let analysisAudioUrl = reference.audio_url;
  let sourceIdentityUrl = reference.audio_url;
  if (reference.media_asset_id) {
    const assetResult = await service.from("media_assets")
      .select("id,bucket_name,storage_path,public_url,visibility")
      .eq("id", reference.media_asset_id)
      .eq("owner_id", reference.owner_id)
      .maybeSingle();
    if (assetResult.error) throw new Error(assetResult.error.message);
    const asset = assetResult.data;
    if (!asset) {
      const failed = await db.from("mastering_references").update({
        status: "failed",
        error: "The mastering reference media asset no longer exists.",
        updated_at: new Date().toISOString(),
      }).eq("id", reference.id).eq("owner_id", reference.owner_id);
      if (failed.error) throw new Error(failed.error.message);
      return { dispatched: false, busy: false, reason: "failed" as const };
    }
    if (asset.visibility === "private") {
      const signed = await service.storage.from(asset.bucket_name).createSignedUrl(asset.storage_path, 60 * 60);
      if (signed.error || !signed.data?.signedUrl) {
        throw new Error(signed.error?.message || "Could not create a private mastering-reference read URL.");
      }
      analysisAudioUrl = signed.data.signedUrl;
      sourceIdentityUrl = `media-asset:${asset.id}`;
    } else if (asset.public_url) {
      analysisAudioUrl = asset.public_url;
      sourceIdentityUrl = `media-asset:${asset.id}`;
    }
  }

  if (!analysisAudioUrl) {
    const failed = await db.from("mastering_references").update({
      status: "failed",
      error: "The uploaded mastering reference has no readable audio source.",
      updated_at: new Date().toISOString(),
    }).eq("id", reference.id).eq("owner_id", reference.owner_id);
    if (failed.error) throw new Error(failed.error.message);
    return { dispatched: false, busy: false, reason: "failed" as const };
  }

  const credential = createMediaWorkerCallbackCredential();
  const baseState = withoutCredential(record(reference.analysis_state));
  const analysisState = {
    ...baseState,
    status: "queued",
    queued_at: new Date().toISOString(),
    [MEDIA_WORKER_CALLBACK_HASH_KEY]: credential.hash,
  };

  const claimed = await db.from("mastering_references").update({
    status: "queued",
    analysis_state: json(analysisState),
    external_job_id: null,
    error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", reference.id).eq("owner_id", reference.owner_id).eq("status", "pending").select("*").maybeSingle();
  if (claimed.error) throw new Error(claimed.error.message);
  if (!claimed.data) return { dispatched: false, busy: true, reason: "busy" as const };

  try {
    const dispatch = await dispatchMediaWorkerJob({
      jobId: reference.id,
      jobType: "analyze_audio",
      payload: {
        audio_url: analysisAudioUrl,
        source_audio_url: sourceIdentityUrl || analysisAudioUrl,
        source_media_asset_id: reference.media_asset_id,
      },
      callbackUrl: `${getSiteUrl()}/api/studio/mastering/references/callback`,
      callbackToken: credential.token,
    }, {
      entitlements: await activeCapabilitiesForOwner(reference.owner_id),
    });

    const update = await db.from("mastering_references").update({
      external_job_id: dispatch.sandboxName,
      updated_at: new Date().toISOString(),
    }).eq("id", reference.id).eq("owner_id", reference.owner_id);
    if (update.error) throw new Error(update.error.message);
    return { dispatched: true, busy: false, reason: "started" as const };
  } catch (error) {
    const cleanState = withoutCredential(analysisState);
    if (isMediaWorkerCapacityError(error)) {
      const message = mediaWorkerCapacityErrorMessage(error);
      await db.from("mastering_references").update({
        status: "pending",
        analysis_state: json({ ...cleanState, status: "pending" }),
        external_job_id: null,
        error: message,
        updated_at: new Date().toISOString(),
      }).eq("id", reference.id).eq("owner_id", reference.owner_id);
      return {
        dispatched: false,
        busy: false,
        reason: "capacity" as const,
        retryAt: mediaWorkerCapacityRetryAfter(message),
      };
    }
    if (isMediaWorkerBusyError(error)) {
      await db.from("mastering_references").update({
        status: "pending",
        analysis_state: json({ ...cleanState, status: "pending" }),
        external_job_id: null,
        error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", reference.id).eq("owner_id", reference.owner_id);
      return { dispatched: false, busy: true, reason: "busy" as const };
    }

    const message = error instanceof Error ? error.message : "Reference analysis dispatch failed.";
    await db.from("mastering_references").update({
      status: "failed",
      analysis_state: json({ ...cleanState, status: "failed" }),
      external_job_id: null,
      error: message,
      updated_at: new Date().toISOString(),
    }).eq("id", reference.id).eq("owner_id", reference.owner_id);
    throw new Error(message);
  }
}

