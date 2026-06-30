import type {
  ContentItem,
  HomepagePlacement,
  MediaAsset,
  MediaLink,
  Release,
  ReleaseExternalLink,
  Track,
} from "@/types/database";

export type ReadinessItem = {
  id: string;
  label: string;
  detail: string;
  complete: boolean;
  blocking: boolean;
  href: string;
};

export type ReleaseReadiness = {
  score: number;
  completed: number;
  total: number;
  blockers: ReadinessItem[];
  recommendations: ReadinessItem[];
  items: ReadinessItem[];
  canPublish: boolean;
};

type ReadinessInput = {
  release: Release;
  tracks: Track[];
  placement?: HomepagePlacement | null;
  mediaAssets?: MediaAsset[];
  mediaLinks?: MediaLink[];
  externalLinks?: ReleaseExternalLink[];
  content?: ContentItem[];
  unresolvedConflicts?: number;
};

export function calculateReleaseReadiness({
  release,
  tracks,
  placement = null,
  mediaAssets = [],
  mediaLinks = [],
  externalLinks = [],
  content = [],
  unresolvedConflicts = 0,
}: ReadinessInput): ReleaseReadiness {
  const base = `/studio/releases/${release.id}`;
  const publicCover = mediaLinks.some((link) => {
    const asset = mediaAssets.find((item) => item.id === link.media_asset_id);
    return link.role === "cover" && asset?.visibility === "public";
  });
  const hasArtwork = Boolean(release.artwork_url || publicCover);
  const orderedTracks = tracks.length > 0 && tracks.every((track) => track.display_order >= 0);
  const hasListeningDestination = tracks.some(
    (track) => track.audio_url || track.soundcloud_url || track.spotify_url,
  ) || externalLinks.some((link) => Boolean(link.external_url));
  const hasPlatformLink = Boolean(
    release.spotify_url ||
      release.soundcloud_url ||
      release.youtube_url ||
      release.smart_link_url ||
      externalLinks.length,
  );
  const intendsHomepage = Boolean(placement?.enabled || release.homepage_eligible);
  const homepageTrackValid = !placement?.enabled || Boolean(
    placement.default_track_id && tracks.some((track) => track.id === placement.default_track_id),
  );
  const hasCampaignAsset = mediaAssets.some((asset) =>
    ["canvas_video", "visualizer", "social_image", "content_video", "lyric_video"].includes(
      asset.asset_type,
    ),
  );
  const hasCampaignPlan = content.length > 0;

  const items: ReadinessItem[] = [
    {
      id: "identity",
      label: "Release identity",
      detail: "Title, type, artist, and release date are complete.",
      complete: Boolean(release.title && release.release_type && release.artist && release.release_date),
      blocking: true,
      href: `${base}?tab=overview#identity`,
    },
    {
      id: "artwork",
      label: "Public cover artwork",
      detail: "A public cover is attached to the release.",
      complete: hasArtwork,
      blocking: true,
      href: `${base}?tab=media#upload`,
    },
    {
      id: "cover-alt",
      label: "Artwork description",
      detail: "Public cover alt text is present.",
      complete: Boolean(release.cover_alt),
      blocking: true,
      href: `${base}?tab=website#public-details`,
    },
    {
      id: "tracks",
      label: "Tracklist",
      detail: "At least one track is attached and the order is explicit.",
      complete: orderedTracks,
      blocking: true,
      href: `${base}?tab=music#tracklist`,
    },
    {
      id: "playback",
      label: "Playable destination",
      detail: "At least one preview or external listening link is available.",
      complete: hasListeningDestination,
      blocking: true,
      href: `${base}?tab=music#tracklist`,
    },
    {
      id: "platform-links",
      label: "Platform links reviewed",
      detail: "At least one release-level platform or smart link is present.",
      complete: hasPlatformLink,
      blocking: false,
      href: `${base}?tab=music#platform-links`,
    },
    {
      id: "homepage-placement",
      label: "Homepage placement",
      detail: intendsHomepage
        ? "Homepage intent and placement are configured."
        : "This release is intentionally excluded from the homepage.",
      complete: !intendsHomepage || Boolean(placement),
      blocking: Boolean(release.active_release),
      href: `${base}?tab=website#placement`,
    },
    {
      id: "homepage-track",
      label: "Homepage default track",
      detail: "The configured homepage player track belongs to this release.",
      complete: homepageTrackValid,
      blocking: Boolean(placement?.enabled),
      href: `${base}?tab=website#placement`,
    },
    {
      id: "visibility",
      label: "Visibility intentionally set",
      detail: "Public visibility and publish state agree.",
      complete:
        (release.publish_state === "live" && release.is_public) ||
        (release.publish_state !== "live" && !release.is_public),
      blocking: true,
      href: `${base}?tab=website#publishing`,
    },
    {
      id: "campaign-plan",
      label: "Campaign plan",
      detail: "At least one content action is connected to the release.",
      complete: hasCampaignPlan,
      blocking: false,
      href: `${base}?tab=campaign#content-plan`,
    },
    {
      id: "campaign-assets",
      label: "Campaign asset coverage",
      detail: "A motion or social asset is attached for campaign use.",
      complete: hasCampaignAsset,
      blocking: false,
      href: `${base}?tab=media#assets`,
    },
    {
      id: "reconciliation",
      label: "External matches resolved",
      detail: "No critical SoundCloud or Spotify conflicts remain.",
      complete: unresolvedConflicts === 0,
      blocking: true,
      href: "/studio/data-health?category=unmatched",
    },
  ];

  const completed = items.filter((item) => item.complete).length;
  const blockers = items.filter((item) => item.blocking && !item.complete);
  const recommendations = items.filter((item) => !item.blocking && !item.complete);

  return {
    score: Math.round((completed / items.length) * 100),
    completed,
    total: items.length,
    blockers,
    recommendations,
    items,
    canPublish: blockers.length === 0,
  };
}
