import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getReleases } from "@/lib/releases";
import type { Database } from "@/types/database";

function releaseType(value: string) {
  return [
    "Single",
    "EP",
    "Album",
    "Album Track",
    "Edit",
    "Instrumental",
    "DJ Tool",
  ].includes(value)
    ? value
    : "Single";
}

function durationSeconds(value?: string) {
  if (!value) return null;
  const [minutes, seconds] = value.split(":").map(Number);
  return Number.isFinite(minutes) && Number.isFinite(seconds)
    ? minutes * 60 + seconds
    : null;
}

export async function syncPublicReleaseCatalog(
  supabase: SupabaseClient<Database>,
  ownerId: string,
) {
  const catalog = getReleases();
  const { data: existing, error: existingError } = await supabase
    .from("releases")
    .select("*")
    .eq("owner_id", ownerId);
  if (existingError) throw new Error(existingError.message);

  for (const source of catalog) {
    const current = existing?.find(
      (release) =>
        release.public_slug === source.slug || release.slug === source.slug,
    );
    const spotifyUrl = source.albumLinks.find((link) =>
      link.platform.toLowerCase().includes("spotify"),
    )?.href;
    const youtubeUrl = source.albumLinks.find((link) =>
      link.platform.toLowerCase().includes("youtube"),
    )?.href;
    const soundcloudUrl = source.tracks.find(
      (track) => track.source === "soundcloud",
    )?.url;
    const releaseRow = {
      owner_id: ownerId,
      title: source.title,
      slug: source.slug,
      release_type: releaseType(source.type),
      status:
        source.releaseDate && Date.parse(source.releaseDate) <= Date.now()
          ? "Live"
          : "Scheduled",
      release_date: source.releaseDate ?? null,
      story: current?.story || source.description || null,
      spotify_url: current?.spotify_url || spotifyUrl || null,
      soundcloud_url: current?.soundcloud_url || soundcloudUrl || null,
      youtube_url: current?.youtube_url || youtubeUrl || null,
      smart_link_url: current?.smart_link_url || source.ctaHref || null,
      artwork_url: source.coverUrl,
      public_slug: source.slug,
      public_release_path: `public/releases/${source.slug}/release.json`,
    };
    const releaseResult = current
      ? await supabase
          .from("releases")
          .update(releaseRow)
          .eq("id", current.id)
          .select("id")
          .single()
      : await supabase
          .from("releases")
          .upsert(releaseRow, { onConflict: "owner_id,slug" })
          .select("id")
          .single();
    if (releaseResult.error) throw new Error(releaseResult.error.message);

    if (source.tracks.length) {
      const trackRows = source.tracks.map((track, index) => ({
        owner_id: ownerId,
        release_id: releaseResult.data.id,
        title: track.title,
        version:
          track.source === "soundcloud"
            ? "SoundCloud catalog"
            : "Public master",
        duration: durationSeconds(track.duration),
        audio_url: track.source === "local" ? track.url : null,
        soundcloud_url: track.source === "soundcloud" ? track.url : null,
        spotify_url:
          track.links.find((link) =>
            link.platform.toLowerCase().includes("spotify"),
          )?.href ?? null,
        is_primary: track.active || index === 0,
      }));
      const { error: trackError } = await supabase
        .from("tracks")
        .upsert(trackRows, { onConflict: "release_id,title" });
      if (trackError) throw new Error(trackError.message);
    }
  }
  return catalog.length;
}
