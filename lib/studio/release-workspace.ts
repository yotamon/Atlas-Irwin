import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createMediaPreviewMap } from "@/lib/studio/media-previews";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import { asMomentsClient } from "@/lib/studio/moments-db";
import { curateCalibratedReleaseMoments } from "@/lib/studio/moments-calibrated-curator";
import { asMarketingClient } from "@/lib/marketing/db";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { getPublicReleases } from "@/lib/public-catalog";
import type { ArtistContext } from "@/lib/studio/artist-context";
import type { Database, MusicVideoProject } from "@/types/database";
import type { LyricsDatabase } from "@/types/lyrics-database";

export class ReleaseWorkspaceNotFoundError extends Error {
  constructor(message = "Release workspace not found") {
    super(message);
    this.name = "ReleaseWorkspaceNotFoundError";
  }
}

function normalizedTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export async function loadReleaseWorkspaceSnapshot(input: {
  db: SupabaseClient<Database>;
  ownerId: string;
  artist: ArtistContext;
  releaseId: string;
  advanced: boolean;
  tab: string;
}) {
  const music = asArtistScopedMusicClient(input.db);
  const operational = asArtistScopedOperationalClient(input.db);
  const momentsDb = asMomentsClient(input.db);
  const lyricsDb = input.db as unknown as SupabaseClient<LyricsDatabase>;
  const marketing = asMarketingClient(input.db);
  const growth = asGrowthClient(input.db);

  const [
    releaseResult,
    tracksResult,
    placementResult,
    mediaLinksResult,
    contentCountResult,
    contactCountResult,
    externalLinksResult,
    contentItemsResult,
    metricsResult,
    playbookTasksResult,
    soundCloudResult,
    spotifyResult,
    campaignResult,
    vaultsResult,
  ] = await Promise.all([
    music.from("releases").select("*").eq("id", input.releaseId).eq("artist_id", input.artist.artistId).maybeSingle(),
    music.from("tracks").select("*").eq("release_id", input.releaseId).eq("artist_id", input.artist.artistId).order("display_order").order("is_primary", { ascending: false }),
    music.from("homepage_placements").select("*").eq("release_id", input.releaseId).eq("artist_id", input.artist.artistId).maybeSingle(),
    music.from("media_links").select("*").eq("release_id", input.releaseId).eq("artist_id", input.artist.artistId),
    operational.from("content_items").select("id", { count: "exact", head: true }).eq("release_id", input.releaseId).eq("artist_id", input.artist.artistId),
    operational.from("outreach_messages").select("id", { count: "exact", head: true }).eq("release_id", input.releaseId).eq("artist_id", input.artist.artistId),
    music.from("release_external_links").select("*").eq("release_id", input.releaseId).eq("artist_id", input.artist.artistId),
    operational.from("content_items").select("*").eq("release_id", input.releaseId).eq("artist_id", input.artist.artistId).order("scheduled_at"),
    operational.from("metric_snapshots").select("*").eq("release_id", input.releaseId).eq("artist_id", input.artist.artistId).order("date"),
    operational.from("tasks").select("id,title,status,priority,due_at").eq("owner_id", input.ownerId).eq("artist_id", input.artist.artistId).eq("release_id", input.releaseId).order("due_at", { ascending: true }),
    input.db.from("soundcloud_tracks").select("*").eq("owner_id", input.ownerId).eq("reconcile_status", "pending"),
    input.db.from("spotify_tracks").select("*").eq("owner_id", input.ownerId).eq("reconcile_status", "pending"),
    marketing.from("campaigns").select("id,name,status,mode,objective,primary_kpi").eq("owner_id", input.ownerId).eq("artist_id", input.artist.artistId).eq("release_id", input.releaseId).not("status", "in", '("archived")').order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    growth.from("track_vault").select("*").eq("owner_id", input.ownerId).eq("artist_id", input.artist.artistId).eq("linked_release_id", input.releaseId).order("updated_at", { ascending: false }),
  ]);

  if (releaseResult.error) throw new Error(releaseResult.error.message);
  const release = releaseResult.data;
  if (!release) throw new ReleaseWorkspaceNotFoundError();

  const requiredError = [
    tracksResult.error,
    placementResult.error,
    mediaLinksResult.error,
    contentCountResult.error,
    contactCountResult.error,
    externalLinksResult.error,
    contentItemsResult.error,
    metricsResult.error,
    playbookTasksResult.error,
    soundCloudResult.error,
    spotifyResult.error,
  ].find(Boolean);
  if (requiredError) throw new Error(requiredError.message);

  // These domains enrich a canonical release. Their temporary failure must not make
  // the release disappear or block editing the music/catalog data itself.
  const campaign = campaignResult.error ? null : campaignResult.data;
  const vaultTracks = vaultsResult.error ? [] : vaultsResult.data ?? [];
  const tracks = tracksResult.data ?? [];
  const contentItems = contentItemsResult.data ?? [];
  const mediaLinks = mediaLinksResult.data ?? [];

  const trackIds = tracks.map((track) => track.id);
  const { data: externalTrackIds, error: externalTrackIdsError } = trackIds.length
    ? await music.from("track_external_ids").select("*").eq("artist_id", input.artist.artistId).in("track_id", trackIds)
    : { data: [], error: null };
  if (externalTrackIdsError) throw new Error(externalTrackIdsError.message);

  const assetIds = [...new Set(mediaLinks.map((link) => link.media_asset_id))];
  const mediaAssetsResult = assetIds.length
    ? await input.db.from("media_assets").select("*").eq("owner_id", input.ownerId).in("id", assetIds)
    : { data: [], error: null };
  if (mediaAssetsResult.error) throw new Error(mediaAssetsResult.error.message);

  const contentIds = contentItems.map((item) => item.id);
  const { count: providerScheduledCount, error: providerScheduleError } = contentIds.length
    ? await marketing.from("publication_jobs").select("id", { count: "exact", head: true }).eq("owner_id", input.ownerId).eq("artist_id", input.artist.artistId).eq("status", "provider_scheduled" as never).in("content_item_id", contentIds)
    : { count: 0, error: null };
  // Unknown downstream scheduling state is safety-critical: fail closed rather than
  // accidentally allowing edits that conflict with already committed provider jobs.
  if (providerScheduleError) throw new Error(providerScheduleError.message);

  const [momentsResult, performanceResult, calibrationResult] = await Promise.all([
    momentsDb.from("moments").select("*").eq("release_id", input.releaseId).eq("artist_id", input.artist.artistId).order("confidence", { ascending: false }).order("start_ms", { ascending: true }),
    momentsDb.from("moment_performance_rollups").select("*").eq("release_id", input.releaseId).eq("artist_id", input.artist.artistId),
    momentsDb.from("moment_calibration_events").select("*").eq("release_id", input.releaseId).eq("artist_id", input.artist.artistId).order("created_at", { ascending: false }).limit(250),
  ]);
  const safeMoments = momentsResult.error ? [] : momentsResult.data ?? [];
  const safeMomentPerformance = performanceResult.error ? [] : performanceResult.data ?? [];
  const calibrationEvents = calibrationResult.error ? [] : calibrationResult.data ?? [];

  const trackLyricsResult = trackIds.length
    ? await lyricsDb.from("track_lyrics").select("id,track_id").eq("artist_id", input.artist.artistId).in("track_id", trackIds)
    : { data: [], error: null };
  const safeTrackLyrics = trackLyricsResult.error ? [] : trackLyricsResult.data ?? [];
  const lyricsIds = safeTrackLyrics.map((lyrics) => lyrics.id);
  const [lyricSectionsResult, lyricSourcesResult] = await Promise.all([
    lyricsIds.length
      ? lyricsDb.from("track_lyric_sections").select("id,lyrics_id,section_key,section_type,label,start_ms,end_ms,confidence,is_primary_hook").eq("artist_id", input.artist.artistId).in("lyrics_id", lyricsIds)
      : Promise.resolve({ data: [], error: null }),
    trackIds.length
      ? lyricsDb.from("track_lyric_moments").select("id,track_id,section_key,excerpt,start_ms,end_ms,score").eq("artist_id", input.artist.artistId).in("track_id", trackIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const safeLyricSections = lyricSectionsResult.error ? [] : lyricSectionsResult.data ?? [];
  const safeLyricSources = lyricSourcesResult.error ? [] : lyricSourcesResult.data ?? [];

  const trackByLyricsId = new Map(safeTrackLyrics.map((lyrics) => [lyrics.id, lyrics.track_id]));
  const momentCuration = curateCalibratedReleaseMoments({
    moments: safeMoments,
    calibrationEvents,
    sections: safeLyricSections.map((section) => ({
      id: section.id,
      track_id: trackByLyricsId.get(section.lyrics_id) ?? "",
      section_key: section.section_key,
      section_type: section.section_type,
      label: section.label,
      start_ms: section.start_ms,
      end_ms: section.end_ms,
      confidence: section.confidence,
      is_primary_hook: section.is_primary_hook,
    })).filter((section) => Boolean(section.track_id)),
    lyricMoments: safeLyricSources,
  });

  let mediaPreviewUrls: Record<string, string> = {};
  let videoProjects: MusicVideoProject[] = [];
  let relevantSoundCloud: typeof soundCloudResult.data = [];
  let relevantSpotify: typeof spotifyResult.data = [];
  let publicReleases: Awaited<ReturnType<typeof getPublicReleases>> = [];

  if (input.advanced) {
    mediaPreviewUrls = await createMediaPreviewMap(input.db, mediaAssetsResult.data ?? []);
    if (input.tab === "video") {
      const videoResult = await input.db.from("music_video_projects").select("*").eq("release_id", input.releaseId).eq("owner_id", input.ownerId).order("created_at", { ascending: false });
      if (videoResult.error) throw new Error(videoResult.error.message);
      videoProjects = videoResult.data ?? [];
    }

    const releaseTerms = new Set([release.title, ...tracks.map((track) => track.title)].map(normalizedTitle));
    relevantSoundCloud = (soundCloudResult.data ?? []).filter((item) => releaseTerms.has(normalizedTitle(item.title)));
    relevantSpotify = (spotifyResult.data ?? []).filter((item) => releaseTerms.has(normalizedTitle(item.name)));
    publicReleases = (await getPublicReleases()).filter((item) => item.artist === input.artist.artistName);
  }

  return {
    release,
    tracks,
    placement: placementResult.data,
    mediaLinks,
    mediaAssets: mediaAssetsResult.data ?? [],
    mediaPreviewUrls,
    externalLinks: externalLinksResult.data ?? [],
    externalTrackIds: externalTrackIds ?? [],
    contentCount: contentCountResult.count ?? 0,
    contactCount: contactCountResult.count ?? 0,
    contentItems,
    metrics: metricsResult.data ?? [],
    playbookTasks: playbookTasksResult.data ?? [],
    providerScheduledCount: providerScheduledCount ?? 0,
    campaign,
    vaultTracks,
    moments: momentCuration.curated,
    historicalMoments: momentCuration.historical,
    rawMomentCount: momentCuration.raw_active_count,
    suppressedMomentCount: momentCuration.suppressed_count,
    momentPerformance: safeMomentPerformance,
    lyricSources: safeLyricSources,
    calibrationEvents,
    relevantSoundCloud: relevantSoundCloud ?? [],
    relevantSpotify: relevantSpotify ?? [],
    publicReleases,
    videoProjects,
  };
}
