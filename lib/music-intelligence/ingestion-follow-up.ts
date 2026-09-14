import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  reconcileCanonicalTrackIntelligence,
  type CanonicalTrackReconciliation,
} from "@/lib/music-intelligence/reconcile-canonical-track";
import { asGrowthClient } from "@/lib/studio/growth-db";
import type { Database, Json } from "@/types/database";

const FOLLOW_UP_RECOVERY_GRACE_MS = 2 * 60 * 1000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function timestamp(value: unknown) {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function musicIngestionFollowUpStatus(result: CanonicalTrackReconciliation) {
  if (result.lyrics.state === "failed" || result.stems.state === "failed") return "needs_attention" as const;
  if (result.lyrics.state === "needs_input" || result.stems.state === "needs_input") return "needs_input" as const;
  if (result.stems.state === "processing") return "waiting" as const;
  return "completed" as const;
}

export type MusicIngestionFollowUpTarget = {
  vaultTrackId: string;
  trackId: string;
  ownerId: string;
  requestId: string | null;
  audioUrl: string;
};

export async function runMusicIngestionFollowUp({
  client,
  target,
}: {
  client: SupabaseClient<Database>;
  target: MusicIngestionFollowUpTarget;
}) {
  const growth = asGrowthClient(client);

  async function persist(state: Record<string, unknown>) {
    const current = await growth.from("track_vault")
      .select("analysis,audio_url,linked_track_id")
      .eq("id", target.vaultTrackId)
      .eq("owner_id", target.ownerId)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) return false;
    if (current.data.audio_url !== target.audioUrl || current.data.linked_track_id !== target.trackId) return false;

    const currentAnalysis = record(current.data.analysis);
    const currentRequestId = typeof currentAnalysis.request_id === "string" ? currentAnalysis.request_id : null;
    if (target.requestId && currentRequestId !== target.requestId) return false;

    const update = await growth.from("track_vault").update({
      analysis: json({ ...currentAnalysis, ingestion_follow_up: state }),
    }).eq("id", target.vaultTrackId)
      .eq("owner_id", target.ownerId)
      .eq("audio_url", target.audioUrl)
      .eq("linked_track_id", target.trackId);
    if (update.error) throw new Error(update.error.message);
    return true;
  }

  try {
    const result = await reconcileCanonicalTrackIntelligence({
      client,
      trackId: target.trackId,
      expectedOwnerId: target.ownerId,
      expectedAudioUrl: target.audioUrl,
    });
    await persist({
      status: musicIngestionFollowUpStatus(result),
      track_id: result.trackId,
      release_id: result.releaseId,
      completed_at: new Date().toISOString(),
      lyrics: result.lyrics,
      stems: result.stems,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persist({
      status: "needs_attention",
      track_id: target.trackId,
      completed_at: new Date().toISOString(),
      message,
    }).catch(() => undefined);
    throw error;
  }
}

export async function recoverStrandedMusicIngestionFollowUp({
  client,
  now = Date.now(),
}: {
  client: SupabaseClient<Database>;
  now?: number;
}) {
  const growth = asGrowthClient(client);
  const result = await growth.from("track_vault")
    .select("id,owner_id,linked_track_id,audio_url,analysis,updated_at")
    .not("linked_track_id", "is", null)
    .not("audio_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(80);
  if (result.error) throw new Error(result.error.message);

  for (const track of result.data ?? []) {
    if (!track.linked_track_id || !track.audio_url) continue;
    const analysis = record(track.analysis);
    if (analysis.status !== "completed") continue;
    const followUp = record(analysis.ingestion_follow_up);
    if (followUp.status !== "queued" && followUp.status !== "waiting") continue;
    const requestedAt = timestamp(followUp.requested_at) || timestamp(track.updated_at);
    if (requestedAt && now - requestedAt < FOLLOW_UP_RECOVERY_GRACE_MS) continue;
    const followUpTrackId = typeof followUp.track_id === "string" ? followUp.track_id : track.linked_track_id;
    if (followUpTrackId !== track.linked_track_id) continue;

    await runMusicIngestionFollowUp({
      client,
      target: {
        vaultTrackId: track.id,
        trackId: track.linked_track_id,
        ownerId: track.owner_id,
        requestId: typeof analysis.request_id === "string" ? analysis.request_id : null,
        audioUrl: track.audio_url,
      },
    });
    return { recovered: true, vaultTrackId: track.id } as const;
  }

  return { recovered: false } as const;
}
