import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import type { ArtistContext } from "@/lib/studio/artist-context";
import type { Database } from "@/types/database";
import type { EnsemblisDatabase } from "@/types/ensemblis-database";
import type { SiteReleaseLink, SiteViewModel } from "@/types/ensemblis-sites";

export async function buildArtistSiteSnapshot(
  client: SupabaseClient<Database>,
  context: ArtistContext,
): Promise<SiteViewModel> {
  const artistDb = client as unknown as SupabaseClient<EnsemblisDatabase>;
  const music = asArtistScopedMusicClient(client);

  const [artistResult, releasesResult, linksResult] = await Promise.all([
    artistDb
      .from("artists")
      .select("id,workspace_id,name,slug,project_type,status,avatar_url,accent_color,legacy_owner_id,created_at,updated_at")
      .eq("id", context.artistId)
      .maybeSingle(),
    music
      .from("releases")
      .select("id,artist_id,title,slug,release_type,release_date,story,artwork_url,cover_asset,genre,spotify_url,soundcloud_url,youtube_url,smart_link_url,cta_label,cta_href,is_public,publish_state,is_archived,updated_at")
      .eq("artist_id", context.artistId)
      .eq("is_public", true)
      .eq("publish_state", "live")
      .eq("is_archived", false)
      .order("release_date", { ascending: false }),
    music
      .from("release_external_links")
      .select("id,artist_id,release_id,provider,external_id,external_url,label,raw_metadata,synced_at,created_at,updated_at")
      .eq("artist_id", context.artistId),
  ]);

  if (artistResult.error) throw new Error(artistResult.error.message);
  if (!artistResult.data) throw new Error("Artist not found while building site snapshot.");
  if (releasesResult.error) throw new Error(releasesResult.error.message);
  if (linksResult.error) throw new Error(linksResult.error.message);

  const externalByRelease = new Map<string, SiteReleaseLink[]>();
  for (const external of linksResult.data ?? []) {
    const current = externalByRelease.get(external.release_id) ?? [];
    current.push({
      label: external.label || external.provider,
      href: external.external_url,
      provider: external.provider,
    });
    externalByRelease.set(external.release_id, current);
  }

  const releases = (releasesResult.data ?? []).map((release) => {
    const links: SiteReleaseLink[] = [...(externalByRelease.get(release.id) ?? [])];
    const push = (provider: string, href: string | null, label = provider) => {
      if (!href || links.some((link) => link.href === href)) return;
      links.push({ provider, href, label });
    };
    push("spotify", release.spotify_url, "Spotify");
    push("soundcloud", release.soundcloud_url, "SoundCloud");
    push("youtube", release.youtube_url, "YouTube");
    push("smart-link", release.smart_link_url || release.cta_href, release.cta_label || "Listen");

    return {
      id: release.id,
      slug: release.slug,
      title: release.title,
      releaseType: release.release_type,
      releaseDate: release.release_date,
      story: release.story,
      artworkUrl: release.artwork_url,
      genre: release.genre,
      links,
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
      avatarUrl: artist.avatar_url,
      accentColor: artist.accent_color,
    },
    releases,
    socialLinks: [],
    contact: { email: null },
    seo: {
      title: artist.name,
      description: description.slice(0, 220),
      imageUrl: latestRelease?.artworkUrl || artist.avatar_url,
    },
  };
}
