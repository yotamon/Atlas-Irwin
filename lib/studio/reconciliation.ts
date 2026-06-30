import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Release, SoundCloudTrack, SpotifyTrack } from "@/types/database";

export type MatchSuggestion = {
  trackId: string;
  releaseId: string;
  releaseTitle: string;
  trackTitle: string;
  score: number;
  reason: string;
};

function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleScore(left: string, right: string) {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 75;
  const aTokens = new Set(a.split(" "));
  const overlap = b.split(" ").filter((token) => aTokens.has(token)).length;
  return overlap > 0 ? overlap * 15 : 0;
}

function durationScore(
  externalSeconds: number | null | undefined,
  trackSeconds: number | null | undefined,
) {
  if (!externalSeconds || !trackSeconds) return 0;
  const delta = Math.abs(externalSeconds - trackSeconds);
  if (delta <= 2) return 30;
  if (delta <= 8) return 15;
  return 0;
}

export async function suggestTrackMatches(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  input: {
    title: string;
    durationSeconds?: number | null;
    isrc?: string | null;
  },
): Promise<MatchSuggestion[]> {
  const { data: tracks, error } = await supabase
    .from("tracks")
    .select("*,releases(title)")
    .eq("owner_id", ownerId);
  if (error) throw new Error(error.message);

  const suggestions: MatchSuggestion[] = [];
  for (const track of tracks ?? []) {
    const release = track.releases as unknown as Pick<Release, "title"> | null;
    if (!release) continue;
    let score = titleScore(input.title, track.title);
    let reason = "Title similarity";
    score += durationScore(input.durationSeconds, track.duration);
    if (score > titleScore(input.title, track.title)) {
      reason = "Title and duration similarity";
    }
    if (input.isrc) {
      const { data: external } = await supabase
        .from("track_external_ids")
        .select("external_id")
        .eq("track_id", track.id)
        .eq("provider", "isrc")
        .maybeSingle();
      if (external?.external_id === input.isrc) {
        score += 100;
        reason = "Exact ISRC match";
      }
    }
    if (score >= 60) {
      suggestions.push({
        trackId: track.id,
        releaseId: track.release_id,
        releaseTitle: release.title,
        trackTitle: track.title,
        score,
        reason,
      });
    }
  }
  return suggestions.sort((a, b) => b.score - a.score).slice(0, 5);
}

export async function linkSoundCloudTrack(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  soundcloudTrackId: string,
  canonicalTrackId: string,
) {
  const [{ data: external }, { data: track }] = await Promise.all([
    supabase
      .from("soundcloud_tracks")
      .select("*")
      .eq("id", soundcloudTrackId)
      .single(),
    supabase.from("tracks").select("*").eq("id", canonicalTrackId).single(),
  ]);
  if (!external || !track) throw new Error("SoundCloud track or canonical track not found.");
  if (track.owner_id !== ownerId) throw new Error("Track ownership mismatch.");

  const { error: trackUpdateError } = await supabase
    .from("tracks")
    .update({ soundcloud_url: external.permalink_url })
    .eq("id", canonicalTrackId);
  if (trackUpdateError) throw new Error(trackUpdateError.message);

  const { error: externalIdError } = await supabase.from("track_external_ids").upsert(
    {
      owner_id: ownerId,
      track_id: canonicalTrackId,
      provider: "soundcloud",
      external_id: String(external.soundcloud_id),
      external_url: external.permalink_url,
      raw_metadata: external.raw_track,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "track_id,provider" },
  );
  if (externalIdError) throw new Error(externalIdError.message);

  const { error: reconcileError } = await supabase
    .from("soundcloud_tracks")
    .update({
      linked_track_id: canonicalTrackId,
      linked_release_id: track.release_id,
      reconcile_status: "linked",
      reconciled_at: new Date().toISOString(),
    })
    .eq("id", soundcloudTrackId);
  if (reconcileError) throw new Error(reconcileError.message);
}

export async function dismissExternalTrack(
  supabase: SupabaseClient<Database>,
  table: "soundcloud_tracks" | "spotify_tracks" | "spotify_albums",
  id: string,
  status: "ignored" | "dismissed" = "dismissed",
) {
  const { error } = await supabase
    .from(table)
    .update({
      reconcile_status: status,
      reconciled_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export function isUnmatchedExternal(
  item: Pick<SoundCloudTrack | SpotifyTrack, "reconcile_status" | "linked_track_id">,
) {
  return item.reconcile_status === "pending" && !item.linked_track_id;
}

export async function resolveMetricReleaseId(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  soundcloudTrack: Pick<SoundCloudTrack, "permalink_url" | "linked_release_id" | "linked_track_id">,
) {
  if (soundcloudTrack.linked_release_id) return soundcloudTrack.linked_release_id;
  if (soundcloudTrack.linked_track_id) {
    const { data } = await supabase
      .from("tracks")
      .select("release_id")
      .eq("id", soundcloudTrack.linked_track_id)
      .maybeSingle();
    if (data?.release_id) return data.release_id;
  }
  const { data: byUrl } = await supabase
    .from("tracks")
    .select("release_id")
    .eq("owner_id", ownerId)
    .eq("soundcloud_url", soundcloudTrack.permalink_url)
    .maybeSingle();
  return byUrl?.release_id ?? null;
}
