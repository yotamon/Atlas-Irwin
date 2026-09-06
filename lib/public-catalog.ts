import "server-only";

import { unstable_cache } from "next/cache";
import type { Release, ReleaseLink, ReleaseTrack } from "@/lib/releases/types";
import {
  formatDurationSeconds,
  formatReleaseDateLabel,
  formatTotalDurationLabel,
  trackNumber,
} from "@/lib/catalog/format";
import {
  createCatalogClient,
  getPublicCatalogOwnerId,
} from "@/lib/supabase/service";
import type {
  HomepagePlacement,
  MediaAsset,
  MediaLink,
  ReleaseExternalLink,
  Release as DbRelease,
  Track,
  TrackExternalId,
} from "@/types/database";
import { hasSupabaseEnv } from "@/lib/supabase/config";

type CatalogBundle = {
  releases: DbRelease[];
  tracks: Track[];
  placements: HomepagePlacement[];
  mediaAssets: MediaAsset[];
  mediaLinks: MediaLink[];
  externalLinks: ReleaseExternalLink[];
  externalTrackIds: TrackExternalId[];
};

async function resolveCatalogOwnerId() {
  const ownerId = getPublicCatalogOwnerId();
  if (!ownerId) {
    throw new Error("PUBLIC_CATALOG_OWNER_ID is required for the public catalog.");
  }
  return ownerId;
}

async function resolveCatalogArtistId() {
  const artistId = process.env.PUBLIC_CATALOG_ARTIST_ID?.trim();
  if (!artistId) {
    throw new Error("PUBLIC_CATALOG_ARTIST_ID is required for the public catalog.");
  }
  return artistId;
}

async function loadCatalogBundle(
  ownerId: string,
  artistId?: string,
): Promise<CatalogBundle> {
  const supabase = createCatalogClient();
  const resolvedArtistId = artistId ?? await resolveCatalogArtistId();

  const [
    releasesResult,
    placementsResult,
    tracksResult,
    mediaLinksResult,
    externalLinksResult,
    externalTrackIdsResult,
  ] = await Promise.all([
    supabase
      .from("releases")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("artist_id", resolvedArtistId)
      .eq("is_public", true)
      .eq("publish_state", "live")
      .eq("is_archived", false),
    supabase
      .from("homepage_placements")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("artist_id", resolvedArtistId)
      .eq("enabled", true)
      .order("display_order", { ascending: true }),
    supabase
      .from("tracks")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("artist_id", resolvedArtistId),
    supabase
      .from("media_links")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("artist_id", resolvedArtistId),
    supabase
      .from("release_external_links")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("artist_id", resolvedArtistId),
    supabase
      .from("track_external_ids")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("artist_id", resolvedArtistId),
  ]);

  for (const result of [
    releasesResult,
    placementsResult,
    tracksResult,
    mediaLinksResult,
    externalLinksResult,
    externalTrackIdsResult,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }

  const releaseIds = new Set((releasesResult.data ?? []).map((release) => release.id));
  const placements = (placementsResult.data ?? []).filter((placement) =>
    releaseIds.has(placement.release_id),
  );
  const tracks = (tracksResult.data ?? []).filter((track) =>
    releaseIds.has(track.release_id),
  );
  const trackIds = new Set(tracks.map((track) => track.id));
  const mediaLinks = (mediaLinksResult.data ?? []).filter(
    (link) =>
      (link.release_id && releaseIds.has(link.release_id)) ||
      (link.track_id && trackIds.has(link.track_id)),
  );
  const assetIds = [...new Set(mediaLinks.map((link) => link.media_asset_id))];
  const mediaAssets =
    assetIds.length === 0
      ? []
      : (
          await supabase
            .from("media_assets")
            .select("*")
            .in("id", assetIds)
            .eq("visibility", "public")
        ).data ?? [];

  return {
    releases: releasesResult.data ?? [],
    tracks,
    placements,
    mediaAssets,
    mediaLinks,
    externalLinks: (externalLinksResult.data ?? []).filter((link) =>
      releaseIds.has(link.release_id),
    ),
    externalTrackIds: (externalTrackIdsResult.data ?? []).filter((item) =>
      trackIds.has(item.track_id),
    ),
  };
}

function primaryMedia(
  bundle: CatalogBundle,
  options: { releaseId?: string; trackId?: string; role: string },
) {
  const links = bundle.mediaLinks
    .filter(
      (link) =>
        link.role === options.role &&
        (options.releaseId === undefined || link.release_id === options.releaseId) &&
        (options.trackId === undefined || link.track_id === options.trackId),
    )
    .sort(
      (a, b) =>
        Number(b.is_primary) - Number(a.is_primary) ||
        a.display_order - b.display_order,
    );

  for (const link of links) {
    const asset = bundle.mediaAssets.find((item) => item.id === link.media_asset_id);
    if (asset) return asset;
  }
  return null;
}

function trackLinks(track: Track, bundle: CatalogBundle): ReleaseLink[] {
  return bundle.externalTrackIds
    .filter((item) => item.track_id === track.id && Boolean(item.external_url))
    .map((item) => ({
      platform: item.provider,
      href: item.external_url as string,
      label: item.provider,
    }));
}

function externalTrackUrl(trackId: string, provider: string, bundle: CatalogBundle) {
  return bundle.externalTrackIds.find(
    (item) =>
      item.track_id === trackId &&
      item.provider.toLowerCase() === provider.toLowerCase() &&
      Boolean(item.external_url),
  )?.external_url ?? null;
}

function albumLinks(releaseId: string, bundle: CatalogBundle): ReleaseLink[] {
  return bundle.externalLinks
    .filter((item) => item.release_id === releaseId && Boolean(item.external_url))
    .map((item) => ({
      platform: item.provider,
      href: item.external_url,
      label: item.label || item.provider,
    }));
}

function mapTrack(
  track: Track,
  index: number,
  bundle: CatalogBundle,
  activeTrackId?: string | null,
): ReleaseTrack {
  const previewAsset = primaryMedia(bundle, {
    trackId: track.id,
    role: "audio_preview",
  });
  const soundcloudUrl = externalTrackUrl(track.id, "soundcloud", bundle);
  const url = soundcloudUrl || previewAsset?.public_url || "";
  const source = soundcloudUrl ? "soundcloud" : "local";

  return {
    number: trackNumber(index, track.track_number),
    title: track.title,
    duration: formatDurationSeconds(track.duration),
    file: soundcloudUrl || previewAsset?.storage_path || track.title,
    url,
    source,
    active: activeTrackId ? track.id === activeTrackId : track.is_primary,
    links: trackLinks(track, bundle),
  };
}

function mapRelease(
  release: DbRelease,
  bundle: CatalogBundle,
  placement?: HomepagePlacement,
): Release {
  const releaseTracks = bundle.tracks
    .filter((track) => track.release_id === release.id)
    .sort(
      (a, b) =>
        a.display_order - b.display_order ||
        Number(b.is_primary) - Number(a.is_primary) ||
        a.title.localeCompare(b.title),
    );
  const activeTrackId =
    placement?.default_track_id ||
    releaseTracks.find((track) => track.is_primary)?.id ||
    releaseTracks[0]?.id ||
    null;
  const tracks = releaseTracks.map((track, index) =>
    mapTrack(track, index, bundle, activeTrackId),
  );
  if (tracks.length && !tracks.some((track) => track.active)) {
    tracks[0] = { ...tracks[0], active: true };
  }

  const coverAsset = primaryMedia(bundle, {
    releaseId: release.id,
    role: "cover",
  });
  if (!coverAsset?.public_url) {
    throw new Error(
      `Published release "${release.title}" is missing a public cover media asset.`,
    );
  }

  const canvasVideoUrl = primaryMedia(bundle, {
    releaseId: release.id,
    role: "canvas_video",
  })?.public_url ?? undefined;
  const releaseLinks = albumLinks(release.id, bundle);

  return {
    slug: release.slug,
    title: release.title,
    type: release.release_type,
    artist: release.artist,
    description: release.story || undefined,
    releaseDate: release.release_date || undefined,
    releaseDateLabel: formatReleaseDateLabel(release.release_date),
    featured: release.is_featured || placement?.placement_type === "featured",
    coverUrl: coverAsset.public_url,
    coverAlt: release.cover_alt || `${release.title} cover art`,
    canvasVideoUrl,
    ctaLabel: release.cta_label || undefined,
    ctaHref: release.cta_href || releaseLinks[0]?.href || tracks[0]?.url,
    genre: release.genre || undefined,
    subgenre: release.subgenre || undefined,
    label: release.label || undefined,
    upc: release.upc || undefined,
    artistLinks: [],
    albumLinks: releaseLinks,
    partners: [],
    trackCount: tracks.length,
    totalDurationLabel: formatTotalDurationLabel(
      releaseTracks.map((track) => track.duration),
    ),
    tracks,
    sortUpdatedAtMs: Date.parse(release.updated_at),
  };
}

async function fetchPublicReleasesUncached(): Promise<Release[]> {
  if (!hasSupabaseEnv()) {
    return [];
  }

  const ownerId = await resolveCatalogOwnerId();
  const artistId = await resolveCatalogArtistId();
  const bundle = await loadCatalogBundle(ownerId, artistId);
  const placementByRelease = new Map(
    bundle.placements.map((placement) => [placement.release_id, placement]),
  );
  const orderedReleaseIds = bundle.placements.map((placement) => placement.release_id);
  const releases = bundle.releases
    .filter((release) => placementByRelease.has(release.id))
    .sort((a, b) => {
      const aIndex = orderedReleaseIds.indexOf(a.id);
      const bIndex = orderedReleaseIds.indexOf(b.id);
      if (aIndex !== bIndex) return aIndex - bIndex;
      if (a.is_featured !== b.is_featured) {
        return Number(b.is_featured) - Number(a.is_featured);
      }
      const aDate = a.release_date ? Date.parse(a.release_date) : 0;
      const bDate = b.release_date ? Date.parse(b.release_date) : 0;
      return bDate - aDate || a.title.localeCompare(b.title);
    });
  return releases.map((release) =>
    mapRelease(release, bundle, placementByRelease.get(release.id)),
  );
}

const getCachedPublicReleases = unstable_cache(
  fetchPublicReleasesUncached,
  ["public-catalog-releases"],
  { revalidate: 60, tags: ["public-catalog"] },
);

export async function getPublicReleases(): Promise<Release[]> {
  return getCachedPublicReleases();
}

export async function getPublicReleaseBySlug(slug: string) {
  const releases = await getPublicReleases();
  return releases.find((release) => release.slug === slug) ?? null;
}

export { resolveCatalogOwnerId, resolveCatalogArtistId, loadCatalogBundle };