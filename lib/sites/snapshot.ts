import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtistContext } from "@/lib/studio/artist-context";
import type { Database } from "@/types/database";
import type {
  SiteReleaseLink,
  SiteTrackCard,
  SiteViewModel,
} from "@/types/ensemblis-sites";

function normalizedDuration(value: number | string | null) {
  if (value === null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function publicAsset(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  return /^(?:\/|https?:\/\/)/i.test(normalized) ? normalized : null;
}

function publicHttpUrl(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function buildArtistSiteSnapshot(
  client: SupabaseClient<Database>,
  context: ArtistContext,
): Promise<SiteViewModel> {
  const [artistResult, releasesResult, linksResult, tracksResult] = await Promise.all([
    client
      .from("artists")
      .select("id,workspace_id,name,slug,project_type,status,avatar_url,accent_color,created_at,updated_at")
      .eq("id", context.artistId)
      .maybeSingle(),
    client
      .from("release_read_model")
      .select("id,artist_id,title,slug,release_type,release_date,story,cover_public_url,genre,spotify_url,soundcloud_url,youtube_url,smart_link_slug,cta_label,cta_href,is_public,publish_state,is_archived,updated_at")
      .eq("artist_id", context.artistId)
      .eq("is_public", true)
      .eq("publish_state", "live")
      .eq("is_archived", false)
      .order("release_date", { ascending: false }),
    client
      .from("release_external_links")
      .select("id,artist_id,release_id,provider,external_id,external_url,label,raw_metadata,synced_at,created_at,updated_at")
      .eq("artist_id", context.artistId),
    client
      .from("track_read_model")
      .select("id,artist_id,release_id,title,track_number,display_order,duration,master_audio_public_url,soundcloud_url,spotify_url,is_primary")
      .eq("artist_id", context.artistId)
      .order("display_order", { ascending: true }),
  ]);

  if (artistResult.error) throw new Error(artistResult.error.message);
  if (!artistResult.data) throw new Error("Artist not found while building site snapshot.");
  if (releasesResult.error) throw new Error(releasesResult.error.message);
  if (linksResult.error) throw new Error(linksResult.error.message);
  if (tracksResult.error) throw new Error(tracksResult.error.message);

  const externalByRelease = new Map<string, SiteReleaseLink[]>();
  for (const external of linksResult.data ?? []) {
    const href = publicHttpUrl(external.external_url);
    if (!href) continue;
    const current = externalByRelease.get(external.release_id) ?? [];
    current.push({
      label: external.label?.trim() || String(external.provider),
      href,
      provider: String(external.provider),
    });
    externalByRelease.set(external.release_id, current);
  }

  const tracksByRelease = new Map<string, SiteTrackCard[]>();
  for (const track of tracksResult.data ?? []) {
    const current = tracksByRelease.get(track.release_id) ?? [];
    current.push({
      id: track.id,
      title: track.title,
      trackNumber: track.track_number,
      displayOrder: track.display_order,
      durationSeconds: normalizedDuration(track.duration),
      audioUrl: publicAsset(track.master_audio_public_url),
      soundcloudUrl: publicHttpUrl(track.soundcloud_url),
      spotifyUrl: publicHttpUrl(track.spotify_url),
      isPrimary: track.is_primary,
    });
    tracksByRelease.set(track.release_id, current);
  }

  const releases = (releasesResult.data ?? []).map((release) => {
    const links: SiteReleaseLink[] = [...(externalByRelease.get(release.id) ?? [])];
    const push = (provider: string, candidate: string | null, label = provider) => {
      const href = publicHttpUrl(candidate);
      if (!href || links.some((link) => link.href === href)) return;
      links.push({ provider, href, label });
    };
    push("spotify", release.spotify_url, "Spotify");
    push("soundcloud", release.soundcloud_url, "SoundCloud");
    push("youtube", release.youtube_url, "YouTube");
    if (release.smart_link_slug) {
      links.push({
        provider: "smart-link",
        href: `/go/${encodeURIComponent(release.smart_link_slug)}`,
        label: release.cta_label || "Listen",
      });
    } else {
      push("cta", release.cta_href, release.cta_label || "Listen");
    }

    return {
      id: release.id,
      slug: release.slug,
      title: release.title,
      releaseType: release.release_type,
      releaseDate: release.release_date,
      story: release.story,
      artworkUrl: publicAsset(release.cover_public_url),
      genre: release.genre,
      links,
      tracks: tracksByRelease.get(release.id) ?? [],
    };
  });

  const artist = artistResult.data;
  const latestRelease = releases[0];
  const description = latestRelease?.story?.trim()
    || (latestRelease ? `${artist.name} — ${latestRelease.title}, music and official releases.` : `${artist.name} — official music and artist site.`);

  return {
    schemaVersion: 1,
    artist: {
      id: artist.id,
      name: artist.name,
      slug: artist.slug,
      bio: null,
      avatarUrl: publicAsset(artist.avatar_url),
      accentColor: artist.accent_color,
    },
    releases,
    socialLinks: [],
    contact: { email: null },
    seo: {
      title: artist.name,
      description: description.slice(0, 220),
      imageUrl: publicHttpUrl(latestRelease?.artworkUrl || artist.avatar_url),
    },
  };
}