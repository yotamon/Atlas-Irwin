import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import type { Database, Release, SoundCloudTrack, SpotifyTrack } from "@/types/database";

export type MatchSuggestion = {
  trackId: string;
  releaseId: string;
  releaseTitle: string;
  trackTitle: string;
  score: number;
  reason: string;
};

type MatchInput = {
  title: string;
  durationSeconds?: number | null;
  isrc?: string | null;
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

export function suggestTrackMatches(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  artistId: string,
  input: MatchInput,
): Promise<MatchSuggestion[]>;
/** @deprecated Active artist scope is mandatory. */
export function suggestTrackMatches(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  input: MatchInput,
): Promise<MatchSuggestion[]>;
export async function suggestTrackMatches(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  artistIdOrInput: string | MatchInput,
  maybeInput?: MatchInput,
): Promise<MatchSuggestion[]> {
  if (typeof artistIdOrInput !== "string" || !maybeInput) {
    throw new Error("Active artist context is required for track matching.");
  }
  const artistId = artistIdOrInput;
  const input = maybeInput;
  const music = asArtistScopedMusicClient(supabase);
  const { data: tracks, error } = await music
    .from("tracks")
    .select("*,releases(title)")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId);
  if (error) throw new Error(error.message);

  const suggestions: MatchSuggestion[] = [];
  for (const track of tracks ?? []) {
    const release = track.releases as unknown as Pick<Release, "title"> | null;
    if (!release) continue;
    const baseScore = titleScore(input.title, track.title);
    let score = baseScore;
    let reason = "Title similarity";
    score += durationScore(input.durationSeconds, track.duration);
    if (score > baseScore) reason = "Title and duration similarity";
    if (input.isrc) {
      const { data: external } = await music
        .from("track_external_ids")
        .select("external_id")
        .eq("track_id", track.id)
        .eq("artist_id", artistId)
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

export function linkSoundCloudTrack(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  artistId: string,
  soundcloudTrackId: string,
  canonicalTrackId: string,
): Promise<void>;
/** @deprecated Prefer the explicit artist-scoped signature. */
export function linkSoundCloudTrack(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  soundcloudTrackId: string,
  canonicalTrackId: string,
): Promise<void>;
export async function linkSoundCloudTrack(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  artistIdOrSoundCloudTrackId: string,
  soundCloudTrackIdOrCanonicalTrackId: string,
  maybeCanonicalTrackId?: string,
) {
  const music = asArtistScopedMusicClient(supabase);
  let artistId: string;
  let soundcloudTrackId: string;
  let canonicalTrackId: string;

  if (maybeCanonicalTrackId) {
    artistId = artistIdOrSoundCloudTrackId;
    soundcloudTrackId = soundCloudTrackIdOrCanonicalTrackId;
    canonicalTrackId = maybeCanonicalTrackId;
  } else {
    soundcloudTrackId = artistIdOrSoundCloudTrackId;
    canonicalTrackId = soundCloudTrackIdOrCanonicalTrackId;
    const { data: scopedTrack, error } = await music
      .from("tracks")
      .select("artist_id")
      .eq("id", canonicalTrackId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!scopedTrack) throw new Error("Canonical track not found for this owner.");
    artistId = scopedTrack.artist_id;
  }

  const [{ data: external }, { data: track, error: trackError }] = await Promise.all([
    supabase.from("soundcloud_tracks").select("*").eq("id", soundcloudTrackId).single(),
    music
      .from("tracks")
      .select("*")
      .eq("id", canonicalTrackId)
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .single(),
  ]);
  if (trackError) throw new Error(trackError.message);
  if (!external || !track) throw new Error("SoundCloud track or canonical track not found for the active artist.");

  const { error: trackUpdateError } = await music
    .from("tracks")
    .update({ soundcloud_url: external.permalink_url })
    .eq("id", canonicalTrackId)
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId);
  if (trackUpdateError) throw new Error(trackUpdateError.message);

  const { error: externalIdError } = await music.from("track_external_ids").upsert(
    {
      owner_id: ownerId,
      artist_id: artistId,
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
    .update({ reconcile_status: status, reconciled_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export function isUnmatchedExternal(
  item: Pick<SoundCloudTrack | SpotifyTrack, "reconcile_status" | "linked_track_id">,
) {
  return item.reconcile_status === "pending" && !item.linked_track_id;
}

export function resolveMetricReleaseId(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  artistId: string,
  soundcloudTrack: Pick<SoundCloudTrack, "permalink_url" | "linked_release_id" | "linked_track_id">,
): Promise<string | null>;
/** @deprecated Active artist scope is mandatory. */
export function resolveMetricReleaseId(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  soundcloudTrack: Pick<SoundCloudTrack, "permalink_url" | "linked_release_id" | "linked_track_id">,
): Promise<string | null>;
export async function resolveMetricReleaseId(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  artistIdOrTrack: string | Pick<SoundCloudTrack, "permalink_url" | "linked_release_id" | "linked_track_id">,
  maybeTrack?: Pick<SoundCloudTrack, "permalink_url" | "linked_release_id" | "linked_track_id">,
) {
  if (typeof artistIdOrTrack !== "string" || !maybeTrack) {
    throw new Error("Active artist context is required for metric reconciliation.");
  }
  const artistId = artistIdOrTrack;
  const soundcloudTrack = maybeTrack;
  const music = asArtistScopedMusicClient(supabase);

  if (soundcloudTrack.linked_release_id) {
    const { data } = await music
      .from("releases")
      .select("id")
      .eq("id", soundcloudTrack.linked_release_id)
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .maybeSingle();
    if (data?.id) return data.id;
  }
  if (soundcloudTrack.linked_track_id) {
    const { data } = await music
      .from("tracks")
      .select("release_id")
      .eq("id", soundcloudTrack.linked_track_id)
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .maybeSingle();
    if (data?.release_id) return data.release_id;
  }
  const { data: byUrl } = await music
    .from("tracks")
    .select("release_id")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .eq("soundcloud_url", soundcloudTrack.permalink_url)
    .maybeSingle();
  return byUrl?.release_id ?? null;
}
