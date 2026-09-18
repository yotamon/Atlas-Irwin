"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { resolveMetricReleaseId, linkSoundCloudTrack } from "@/lib/studio/reconciliation";
import {
  disconnectSoundCloud,
  soundCloudSnapshot,
  syncSoundCloudCatalog,
  syncSoundCloudTrack,
  uploadSoundCloudTrack,
} from "@/lib/studio/soundcloud";
import {
  createSpotifyCampaignPlaylist,
  disconnectSpotify,
  setSpotifyArtist,
  syncSpotify,
} from "@/lib/studio/spotify";
import type { SoundCloudTrack } from "@/types/database";

const required = z.string().trim().min(1).max(300);
const text = z.string().trim().max(10000);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function nullable(form: FormData, key: string) {
  return value(form, key) || null;
}

function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "release"
  );
}

async function scopedContext(form?: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = form ? value(form, "artist_id") || undefined : undefined;
  const artist = await resolveActiveArtistContext(supabase, user, requestedArtistId);
  return {
    supabase,
    user,
    artist,
    music: asArtistScopedMusicClient(supabase),
    marketing: asMarketingClient(supabase),
  };
}

async function uniqueReleaseSlug(
  context: Awaited<ReturnType<typeof scopedContext>>,
  title: string,
) {
  const base = slugify(title);
  for (let index = 0; index < 50; index += 1) {
    const slug = index === 0 ? base : `${base}-${index + 1}`;
    const { data, error } = await context.music
      .from("releases")
      .select("id")
      .eq("owner_id", context.user.id)
      .eq("artist_id", context.artist.artistId)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return slug;
  }
  return `${base}-${Date.now()}`;
}

async function assertActiveRelease(
  context: Awaited<ReturnType<typeof scopedContext>>,
  releaseId: string,
) {
  const { data, error } = await context.music
    .from("releases")
    .select("id")
    .eq("id", releaseId)
    .eq("owner_id", context.user.id)
    .eq("artist_id", context.artist.artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Release not found for the active artist.");
}

export async function syncSoundCloud(form: FormData) {
  const { user } = await requireStudioAdmin();
  await syncSoundCloudCatalog(user.id);
  revalidatePath("/studio/soundcloud");
  if (value(form, "redirect") !== "false") redirect("/studio/soundcloud?synced=1");
}

export async function disconnectSoundCloudAccount() {
  const { user } = await requireStudioAdmin();
  await disconnectSoundCloud(user.id);
  revalidatePath("/studio/soundcloud");
  redirect("/studio/soundcloud?disconnected=1");
}

export async function uploadTrackToSoundCloud(form: FormData) {
  const { user } = await requireStudioAdmin();
  const file = form.get("audio");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose an audio file to upload to SoundCloud.");
  }
  await uploadSoundCloudTrack({
    ownerId: user.id,
    title: required.parse(value(form, "title")),
    file,
    description: nullable(form, "description"),
    genre: nullable(form, "genre"),
    sharing: nullable(form, "sharing") || "private",
  });
  revalidatePath("/studio/soundcloud");
  redirect("/studio/soundcloud?uploaded=1");
}

export async function importSoundCloudTrack(form: FormData) {
  const context = await scopedContext(form);
  const id = z.uuid().parse(value(form, "id"));
  const mode = value(form, "mode") || "create_release";
  const { data: track, error: trackError } = await context.supabase
    .from("soundcloud_tracks")
    .select("*")
    .eq("id", id)
    .eq("owner_id", context.user.id)
    .single();
  if (trackError) throw new Error(trackError.message);

  if (mode === "dismiss") {
    const { error } = await context.supabase
      .from("soundcloud_tracks")
      .update({ reconcile_status: "dismissed", reconciled_at: new Date().toISOString() })
      .eq("id", id)
      .eq("owner_id", context.user.id);
    if (error) throw new Error(error.message);
    revalidatePath("/studio/soundcloud");
    redirect("/studio/soundcloud");
  }

  const releaseIdInput = value(form, "release_id");
  if (mode === "create_track" && releaseIdInput) {
    const releaseId = z.uuid().parse(releaseIdInput);
    await assertActiveRelease(context, releaseId);
    const { data: created, error } = await context.music
      .from("tracks")
      .insert({
        owner_id: context.user.id,
        artist_id: context.artist.artistId,
        release_id: releaseId,
        title: track.title,
        duration: track.duration ? Math.round(track.duration / 1000) : null,
        soundcloud_url: track.permalink_url,
        is_primary: false,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await linkSoundCloudTrack(
      context.supabase,
      context.user.id,
      context.artist.artistId,
      id,
      created.id,
    );
    revalidatePath("/studio/soundcloud");
    redirect(`/studio/releases/${releaseId}?tab=tracks`);
  }

  const slug = await uniqueReleaseSlug(context, track.title);
  const { data: release, error: releaseError } = await context.music
    .from("releases")
    .insert({
      owner_id: context.user.id,
      artist_id: context.artist.artistId,
      title: track.title,
      slug,
      release_type: "Single",
      status: "Live",
      publish_state: "draft",
      is_public: false,
      story: track.description,
      soundcloud_url: track.permalink_url,
      artwork_url: track.artwork_url,
      release_date: null,
    })
    .select("id")
    .single();
  if (releaseError) throw new Error(releaseError.message);

  const { data: createdTrack, error: createTrackError } = await context.music
    .from("tracks")
    .insert({
      owner_id: context.user.id,
      artist_id: context.artist.artistId,
      release_id: release.id,
      title: track.title,
      duration: track.duration ? Math.round(track.duration / 1000) : null,
      soundcloud_url: track.permalink_url,
      is_primary: true,
      notes: `Imported from SoundCloud track ${track.soundcloud_id}.`,
    })
    .select("id")
    .single();
  if (createTrackError) throw new Error(createTrackError.message);

  await linkSoundCloudTrack(
    context.supabase,
    context.user.id,
    context.artist.artistId,
    id,
    createdTrack.id,
  );
  revalidatePath("/studio/releases");
  revalidatePath("/studio/soundcloud");
  redirect(`/studio/releases/${release.id}`);
}

export async function syncSoundCloudMetrics(form: FormData) {
  const context = await scopedContext(form);
  const { data: tracks, error } = await context.supabase
    .from("soundcloud_tracks")
    .select("*")
    .eq("owner_id", context.user.id)
    .order("synced_at", { ascending: false });
  if (error) throw new Error(error.message);
  const today = new Date().toISOString().slice(0, 10);

  for (const storedTrack of tracks ?? []) {
    const track = await syncSoundCloudTrack(context.user.id, storedTrack.soundcloud_id);
    const releaseId = await resolveMetricReleaseId(
      context.supabase,
      context.user.id,
      context.artist.artistId,
      storedTrack,
    );
    if (!releaseId) continue;

    const notes = `SoundCloud API sync: ${track.soundcloud_id}`;
    const snapshot = soundCloudSnapshot(track as SoundCloudTrack);
    const row = {
      owner_id: context.user.id,
      artist_id: context.artist.artistId,
      date: today,
      platform: "SoundCloud",
      release_id: releaseId,
      content_item_id: null,
      reach: snapshot.views,
      views: snapshot.views,
      watch_time: 0,
      likes: snapshot.likes,
      comments: snapshot.comments,
      shares: snapshot.shares,
      saves: 0,
      profile_visits: 0,
      follows: 0,
      link_clicks: 0,
      streams: snapshot.streams,
      listeners: 0,
      playlist_adds: 0,
      notes,
    };
    const { data: existing, error: lookupError } = await context.marketing
      .from("metric_snapshots")
      .select("id")
      .eq("owner_id", context.user.id)
      .eq("artist_id", context.artist.artistId)
      .eq("date", today)
      .eq("platform", "SoundCloud")
      .eq("release_id", releaseId)
      .eq("notes", notes)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);

    const { error: metricError } = existing
      ? await context.marketing
          .from("metric_snapshots")
          .update(row)
          .eq("id", existing.id)
          .eq("owner_id", context.user.id)
          .eq("artist_id", context.artist.artistId)
      : await context.marketing.from("metric_snapshots").insert(row);
    if (metricError) throw new Error(metricError.message);
  }

  revalidatePath("/studio/analytics");
  revalidatePath("/studio/soundcloud");
  redirect("/studio/soundcloud?metrics=1");
}

export async function saveSpotifyArtist(form: FormData) {
  const { user } = await requireStudioAdmin();
  await setSpotifyArtist(user.id, required.parse(value(form, "artist")));
  revalidatePath("/studio/spotify");
  redirect("/studio/spotify?artist=1");
}

export async function syncSpotifyCatalog() {
  const { user } = await requireStudioAdmin();
  await syncSpotify(user.id);
  revalidatePath("/studio/spotify");
  redirect("/studio/spotify?synced=1");
}

export async function disconnectSpotifyAccount() {
  const { user } = await requireStudioAdmin();
  await disconnectSpotify(user.id);
  revalidatePath("/studio/spotify");
  redirect("/studio/spotify?disconnected=1");
}

function spotifyReleaseDate(date: string | null, precision: string | null) {
  if (!date) return null;
  if (precision === "year") return `${date}-01-01`;
  if (precision === "month") return `${date}-01`;
  return date;
}

export async function importSpotifyAlbum(form: FormData) {
  const context = await scopedContext(form);
  const id = z.uuid().parse(value(form, "id"));
  const { data: album, error: albumError } = await context.supabase
    .from("spotify_albums")
    .select("*")
    .eq("id", id)
    .eq("owner_id", context.user.id)
    .single();
  if (albumError) throw new Error(albumError.message);

  const { data: syncedTracks, error: tracksError } = await context.supabase
    .from("spotify_tracks")
    .select("*")
    .eq("owner_id", context.user.id)
    .eq("album_spotify_id", album.spotify_id)
    .order("disc_number")
    .order("track_number");
  if (tracksError) throw new Error(tracksError.message);

  const { data: existingRelease, error: existingError } = await context.music
    .from("releases")
    .select("id")
    .eq("owner_id", context.user.id)
    .eq("artist_id", context.artist.artistId)
    .eq("spotify_url", album.spotify_url)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  let releaseId = existingRelease?.id;
  if (!releaseId) {
    const slug = await uniqueReleaseSlug(context, album.name);
    const releaseType = album.album_type === "single" ? "Single" : album.total_tracks > 6 ? "Album" : "EP";
    const { data: release, error } = await context.music
      .from("releases")
      .insert({
        owner_id: context.user.id,
        artist_id: context.artist.artistId,
        title: album.name,
        slug,
        release_type: releaseType,
        status: "Live",
        publish_state: "draft",
        is_public: false,
        release_date: spotifyReleaseDate(album.release_date, album.release_date_precision),
        spotify_url: album.spotify_url,
        artwork_url: album.image_url,
        notes: `Imported from Spotify album ${album.spotify_id}.`,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    releaseId = release.id;
  }

  const { data: existingTracks, error: existingTracksError } = await context.music
    .from("tracks")
    .select("spotify_url")
    .eq("release_id", releaseId)
    .eq("owner_id", context.user.id)
    .eq("artist_id", context.artist.artistId);
  if (existingTracksError) throw new Error(existingTracksError.message);

  const existingUrls = new Set((existingTracks ?? []).map((track) => track.spotify_url));
  const missing = (syncedTracks ?? []).filter((track) => !existingUrls.has(track.spotify_url));
  if (missing.length) {
    const { error } = await context.music.from("tracks").insert(
      missing.map((track, index) => ({
        owner_id: context.user.id,
        artist_id: context.artist.artistId,
        release_id: releaseId,
        title: track.name,
        duration: Math.round(track.duration_ms / 1000),
        spotify_url: track.spotify_url,
        is_primary: index === 0,
        notes: `Spotify track ${track.spotify_id}${track.isrc ? ` · ISRC ${track.isrc}` : ""}.`,
      })),
    );
    if (error) throw new Error(error.message);
  }

  revalidatePath("/studio/releases");
  revalidatePath("/studio/spotify");
  redirect(`/studio/releases/${releaseId}`);
}

export async function createCampaignPlaylist(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const name = required.parse(value(form, "name"));
  const description = text.parse(value(form, "description"));
  const ids = form.getAll("track_id").map(String).filter(Boolean).slice(0, 100);
  if (!ids.length) throw new Error("Choose at least one synced Spotify track.");

  const { data: tracks, error } = await supabase
    .from("spotify_tracks")
    .select("uri")
    .eq("owner_id", user.id)
    .in("id", ids);
  if (error) throw new Error(error.message);
  if (!tracks?.length) throw new Error("The selected Spotify tracks were not found.");

  const playlist = await createSpotifyCampaignPlaylist({
    ownerId: user.id,
    name,
    description,
    isPublic: value(form, "visibility") === "public",
    uris: tracks.map((track) => track.uri),
  });
  revalidatePath("/studio/spotify");
  redirect(`/studio/spotify?playlist=${encodeURIComponent(playlist.name)}`);
}