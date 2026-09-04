import Link from "next/link";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMediaPreviewMap } from "@/lib/studio/media-previews";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import { asMomentsClient } from "@/lib/studio/moments-db";
import { curateReleaseMoments } from "@/lib/studio/moments-curator";
import { getPublicReleases } from "@/lib/public-catalog";
import { asMarketingClient } from "@/lib/marketing/db";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { MomentReviewPanel } from "@/components/studio/moment-review-panel";
import { ReleaseCockpit } from "@/components/studio/release-cockpit";
import { ReleaseCampaignBridge } from "@/components/studio/release-campaign-bridge";
import { ReleaseWorkspaceV2 } from "@/components/studio/release-workspace-v2";
import type { MusicVideoProject } from "@/types/database";
import type { LyricsDatabase } from "@/types/lyrics-database";

export default async function ReleaseDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; stage?: string; view?: string }>;
}) {
  const { id } = await params;
  const { tab = "overview", stage = "overview", view } = await searchParams;
  const advanced = view === "advanced";
  const renderedAt = new Date().toISOString();
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const music = asArtistScopedMusicClient(supabase);
  const operational = asArtistScopedOperationalClient(supabase);
  const momentsDb = asMomentsClient(supabase);
  const lyricsDb = supabase as unknown as SupabaseClient<LyricsDatabase>;
  const marketing = asMarketingClient(supabase);
  const growth = asGrowthClient(supabase);

  const [
    { data: release },
    { data: tracks },
    { data: placement },
    { data: mediaLinks },
    { count: contentCount },
    { count: contactCount },
    { data: externalLinks },
    { data: contentItems },
    { data: metrics },
    { data: playbookTasks },
    { data: soundCloudPending },
    { data: spotifyPending },
    campaignResult,
    vaultResult,
  ] = await Promise.all([
    music.from("releases").select("*").eq("id", id).eq("artist_id", artist.artistId).single(),
    music.from("tracks").select("*").eq("release_id", id).eq("artist_id", artist.artistId).order("display_order").order("is_primary", { ascending: false }),
    music.from("homepage_placements").select("*").eq("release_id", id).eq("artist_id", artist.artistId).maybeSingle(),
    music.from("media_links").select("*").eq("release_id", id).eq("artist_id", artist.artistId),
    operational.from("content_items").select("id", { count: "exact", head: true }).eq("release_id", id).eq("artist_id", artist.artistId),
    operational.from("outreach_messages").select("id", { count: "exact", head: true }).eq("release_id", id).eq("artist_id", artist.artistId),
    music.from("release_external_links").select("*").eq("release_id", id).eq("artist_id", artist.artistId),
    operational.from("content_items").select("*").eq("release_id", id).eq("artist_id", artist.artistId).order("scheduled_at"),
    operational.from("metric_snapshots").select("*").eq("release_id", id).eq("artist_id", artist.artistId).order("date"),
    operational.from("tasks").select("id,title,status,priority,due_at").eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("release_id", id).order("due_at", { ascending: true }),
    supabase.from("soundcloud_tracks").select("*").eq("owner_id", user.id).eq("reconcile_status", "pending"),
    supabase.from("spotify_tracks").select("*").eq("owner_id", user.id).eq("reconcile_status", "pending"),
    marketing.from("campaigns").select("id,name,status,mode,objective,primary_kpi").eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("release_id", id).not("status", "in", '("archived")').order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    growth.from("track_vault").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("linked_release_id", id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!release) notFound();
  if (campaignResult.error) throw new Error(campaignResult.error.message);
  if (vaultResult.error) throw new Error(vaultResult.error.message);

  const trackIds = (tracks ?? []).map((track) => track.id);
  const { data: externalTrackIds } = trackIds.length
    ? await music.from("track_external_ids").select("*").eq("artist_id", artist.artistId).in("track_id", trackIds)
    : { data: [] };
  const assetIds = [...new Set((mediaLinks ?? []).map((link) => link.media_asset_id))];
  const { data: mediaAssets } = assetIds.length ? await supabase.from("media_assets").select("*").in("id", assetIds) : { data: [] };
  const contentIds = (contentItems ?? []).map((item) => item.id);
  const { count: providerScheduledCount, error: providerScheduleError } = contentIds.length
    ? await marketing.from("publication_jobs").select("id", { count: "exact", head: true }).eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("status", "provider_scheduled" as never).in("content_item_id", contentIds)
    : { count: 0, error: null };
  if (providerScheduleError) throw new Error(providerScheduleError.message);

  const [{ data: moments, error: momentsError }, { data: momentPerformance, error: performanceError }] = await Promise.all([
    momentsDb.from("moments").select("*").eq("release_id", id).eq("artist_id", artist.artistId).order("confidence", { ascending: false }).order("start_ms", { ascending: true }),
    momentsDb.from("moment_performance_rollups").select("*").eq("release_id", id).eq("artist_id", artist.artistId),
  ]);
  if (momentsError) throw new Error(momentsError.message);
  if (performanceError) throw new Error(performanceError.message);

  const { data: trackLyrics, error: trackLyricsError } = trackIds.length
    ? await lyricsDb.from("track_lyrics").select("id,track_id").eq("artist_id", artist.artistId).in("track_id", trackIds)
    : { data: [], error: null };
  if (trackLyricsError) throw new Error(trackLyricsError.message);
  const lyricsIds = (trackLyrics ?? []).map((lyrics) => lyrics.id);
  const [{ data: lyricSections, error: lyricSectionsError }, { data: lyricSources, error: lyricSourcesError }] = await Promise.all([
    lyricsIds.length
      ? lyricsDb.from("track_lyric_sections").select("id,lyrics_id,section_key,section_type,label,start_ms,end_ms,confidence,is_primary_hook").eq("artist_id", artist.artistId).in("lyrics_id", lyricsIds)
      : Promise.resolve({ data: [], error: null }),
    trackIds.length
      ? lyricsDb.from("track_lyric_moments").select("id,track_id,section_key,excerpt,start_ms,end_ms,score").eq("artist_id", artist.artistId).in("track_id", trackIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (lyricSectionsError) throw new Error(lyricSectionsError.message);
  if (lyricSourcesError) throw new Error(lyricSourcesError.message);

  const trackByLyricsId = new Map((trackLyrics ?? []).map((lyrics) => [lyrics.id, lyrics.track_id]));
  const momentCuration = curateReleaseMoments({
    moments: moments ?? [],
    sections: (lyricSections ?? []).map((section) => ({
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
    lyricMoments: lyricSources ?? [],
  });

  if (!advanced) {
    return <>
      <ReleaseWorkspaceV2 release={release} tracks={tracks ?? []} mediaLinks={mediaLinks ?? []} mediaAssets={mediaAssets ?? []} contentItems={contentItems ?? []} metrics={metrics ?? []} campaign={campaignResult.data} stage={stage} renderedAt={renderedAt} playbookTasks={playbookTasks ?? []} providerScheduledCount={providerScheduledCount ?? 0} vaultTrack={vaultResult.data} />
      {stage === "create" ? <MomentReviewPanel releaseId={release.id} moments={momentCuration.curated} historicalMoments={momentCuration.historical} rawCandidateCount={momentCuration.raw_active_count} suppressedCount={momentCuration.suppressed_count} tracks={(tracks ?? []).map((track) => ({ id: track.id, title: track.title, audio_url: track.audio_url }))} performance={momentPerformance ?? []} lyricSources={lyricSources ?? []} /> : null}
    </>;
  }

  const mediaPreviewUrls = await createMediaPreviewMap(supabase, mediaAssets ?? []);
  let videoProjects: MusicVideoProject[] = [];
  if (tab === "video") {
    const { data, error } = await supabase.from("music_video_projects").select("*").eq("release_id", id).eq("owner_id", user.id).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    videoProjects = data ?? [];
  }

  const releaseTerms = new Set([release.title, ...(tracks ?? []).map((track) => track.title)].map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const relevantSoundCloud = (soundCloudPending ?? []).filter((item) => releaseTerms.has(item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const relevantSpotify = (spotifyPending ?? []).filter((item) => releaseTerms.has(item.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const publicReleases = (await getPublicReleases()).filter((item) => item.artist === artist.artistName);

  return <>
    <div className="v2-advanced-banner"><div><strong>Advanced workspace</strong><span>Legacy controls for exceptional cases, migrations and debugging.</span></div><Link className="button" href={`/studio/releases/${release.id}`}>Back to simple view</Link></div>
    {tab === "campaign" ? <ReleaseCampaignBridge campaign={campaignResult.data} /> : null}
    <ReleaseCockpit release={release} tracks={tracks ?? []} placement={placement} mediaLinks={mediaLinks ?? []} mediaAssets={mediaAssets ?? []} mediaPreviewUrls={mediaPreviewUrls} externalLinks={externalLinks ?? []} externalTrackIds={externalTrackIds ?? []} contentCount={contentCount ?? 0} contactCount={contactCount ?? 0} contentItems={contentItems ?? []} metrics={metrics ?? []} unmatchedSoundCloud={relevantSoundCloud} unmatchedSpotify={relevantSpotify} publicReleases={publicReleases} videoProjects={videoProjects} moments={momentCuration.curated} tab={tab} />
  </>;
}