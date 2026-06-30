import "server-only";

import { unstable_cache } from "next/cache";
import type { Release, ReleaseLink, ReleaseTrack } from "@/lib/releases/types";
import {
  formatDurationSeconds,
  formatReleaseDateLabel,
  formatTotalDurationLabel,
  trackNumber,
} from "@/lib/catalog/format";
import { resolveLegacyCanvasVideoUrl } from "@/lib/catalog/legacy-media";
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
import { adminEmails } from "@/lib/auth/studio";
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
  const explicit = getPublicCatalogOwnerId();
  if (explicit) return explicit;

  const supabase = createCatalogClient();
  const emails = adminEmails();
  if (emails.length) {
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", emails[0])
      .maybeSingle();
    if (data?.id) return data.id;
  }

  const { data: admin } = await supabase
    .from("profiles")
    .select("id")
    .eq("is_admin", true)
    .limit(1)
    .maybeSingle();
  if (!admin?.id) {
    throw new Error(
      "No public catalog owner found. Set PUBLIC_CATALOG_OWNER_ID or STUDIO_ADMIN_EMAILS.",
    );
  }
  return admin.id;
}

async function loadCatalogBundle(ownerId: string): Promise<CatalogBundle> {
  const supabase = createCatalogClient();
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
      .eq("is_public", true)
      .eq("publish_state", "live")
      .eq("is_archived", false),
    supabase
      .from("homepage_placements")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("enabled", true)
      .order("display_order", { ascending: true }),
    supabase.from("tracks").select("*").eq("owner_id", ownerId),
    supabase.from("media_links").select("*").eq("owner_id", ownerId),
    supabase
      .from("release_external_links")
      .select("*")
      .eq("owner_id", ownerId),
    supabase.from("track_external_ids").select("*").eq("owner_id", ownerId),
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

  const releaseIds = new Set((releasesResult.data ?? []).map((r) => r.id));
  const placements = (placementsResult.data ?? []).filter((p) =>
    releaseIds.has(p.release_id),
  );
  const tracks = (tracksResult.data ?? []).filter((t) =>
    releaseIds.has(t.release_id),
  );
  const mediaLinks = (mediaLinksResult.data ?? []).filter(
    (link) =>
      (link.release_id && releaseIds.has(link.release_id)) ||
      (link.track_id && tracks.some((t) => t.id === link.track_id)),
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
      tracks.some((track) => track.id === item.track_id),
    ),
  };
}

function primaryMediaUrl(
  bundle: CatalogBundle,
  releaseId: string,
  role: MediaAsset["asset_type"],
) {
  const links = bundle.mediaLinks
    .filter((link) => link.release_id === releaseId && link.role === role)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order);
  for (const link of links) {
    const asset = bundle.mediaAssets.find((item) => item.id === link.media_asset_id);
    if (asset?.public_url) return asset.public_url;
  }
  return null;
}

function trackLinks(track: Track, bundle: CatalogBundle): ReleaseLink[] {
  const links: ReleaseLink[] = [];
  if (track.spotify_url) {
    links.push({
      platform: "Spotify",
      href: track.spotify_url,
      label: "Spotify",
    });
  }
  for (const external of bundle.externalTrackIds.filter(
    (item) => item.track_id === track.id,
  )) {
    if (external.external_url) {
      links.push({
        platform: external.provider,
        href: external.external_url,
        label: external.provider,
      });
    }
  }
  return links;
}

function albumLinks(releaseId: string, release: DbRelease, bundle: CatalogBundle) {
  const links: ReleaseLink[] = [];
  const push = (platform: string, href?: string | null, label?: string | null) => {
    if (!href) return;
    links.push({ platform, href, label: label || platform });
  };
  push("Spotify", release.spotify_url);
  push("SoundCloud", release.soundcloud_url);
  push("YouTube", release.youtube_url);
  push("Smart Link", release.smart_link_url, release.cta_label || "Listen");
  for (const external of bundle.externalLinks.filter(
    (item) => item.release_id === releaseId,
  )) {
    push(external.label || external.provider, external.external_url, external.label || external.provider);
  }
  return links;
}

function mapTrack(
  track: Track,
  index: number,
  bundle: CatalogBundle,
  activeTrackId?: string | null,
): ReleaseTrack {
  const soundcloudUrl = track.soundcloud_url;
  const previewLink = bundle.mediaLinks
    .filter((link) => link.track_id === track.id && link.role === "audio_preview")
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order)[0];
  const previewAsset = previewLink
    ? bundle.mediaAssets.find((asset) => asset.id === previewLink.media_asset_id)
    : null;
  const localUrl = previewAsset?.public_url || track.audio_url;
  const source = soundcloudUrl ? "soundcloud" : "local";
  const url = soundcloudUrl || localUrl || "";
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
  const coverUrl =
    primaryMediaUrl(bundle, release.id, "cover") ||
    release.artwork_url ||
    "/atlas-cover.png";
  const canvasVideoUrl =
    primaryMediaUrl(bundle, release.id, "canvas_video") ||
    resolveLegacyCanvasVideoUrl(release.slug) ||
    undefined;
  return {
    slug: release.slug,
    title: release.title,
    type: release.release_type,
    artist: release.artist || "Atlas Irwin",
    description: release.story || undefined,
    releaseDate: release.release_date || undefined,
    releaseDateLabel: formatReleaseDateLabel(release.release_date),
    featured: release.is_featured || placement?.placement_type === "featured",
    coverUrl,
    coverAlt: release.cover_alt || `${release.title} cover art`,
    canvasVideoUrl,
    ctaLabel: release.cta_label || undefined,
    ctaHref: release.cta_href || release.smart_link_url || tracks[0]?.url,
    genre: release.genre || undefined,
    subgenre: release.subgenre || undefined,
    label: release.label || undefined,
    upc: release.upc || undefined,
    artistLinks: [],
    albumLinks: albumLinks(release.id, release, bundle),
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
  const bundle = await loadCatalogBundle(ownerId);
  const placementByRelease = new Map(
    bundle.placements.map((placement) => [placement.release_id, placement]),
  );
  const orderedReleaseIds = bundle.placements.map((p) => p.release_id);
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

export { resolveCatalogOwnerId, loadCatalogBundle };
