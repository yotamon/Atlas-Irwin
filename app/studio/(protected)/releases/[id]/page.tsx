import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import {
  loadReleaseWorkspaceSnapshot,
  ReleaseWorkspaceNotFoundError,
} from "@/lib/studio/release-workspace";
import { MomentReviewPanel } from "@/components/studio/moment-review-panel";
import { ReleaseCockpit } from "@/components/studio/release-cockpit";
import { ReleaseCampaignBridge } from "@/components/studio/release-campaign-bridge";
import { ReleaseWorkspaceV2 } from "@/components/studio/release-workspace-v2";

function artistFacingReleaseStage(stage: string) {
  if (stage === "music") return "overview";
  if (stage === "plan") return "promotion";
  if (stage === "create") return "content";
  if (stage === "publish") return "distribution";
  if (stage === "learn") return "results";
  return stage;
}

export default async function ReleaseDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; stage?: string; view?: string; artist?: string }>;
}) {
  const { id } = await params;
  const { tab = "overview", stage = "overview", view, artist: requestedArtistId } = await searchParams;
  const simpleStage = artistFacingReleaseStage(stage);
  const advanced = view === "advanced";
  const renderedAt = new Date().toISOString();
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user, requestedArtistId);
  const scopedHref = (path: string) => ensemblisArtistHref(path, artist.artistId);

  let snapshot: Awaited<ReturnType<typeof loadReleaseWorkspaceSnapshot>>;
  try {
    snapshot = await loadReleaseWorkspaceSnapshot({
      db: supabase,
      ownerId: user.id,
      artist,
      releaseId: id,
      advanced,
      tab,
    });
  } catch (error) {
    if (error instanceof ReleaseWorkspaceNotFoundError) notFound();
    throw error;
  }

  if (!advanced) {
    return <>
      <ReleaseWorkspaceV2
        artistId={artist.artistId}
        release={snapshot.release}
        tracks={snapshot.tracks}
        contentItems={snapshot.contentItems}
        metrics={snapshot.metrics}
        campaign={snapshot.campaign}
        stage={simpleStage}
        renderedAt={renderedAt}
        playbookTasks={snapshot.playbookTasks}
        providerScheduledCount={snapshot.providerScheduledCount}
        vaultTracks={snapshot.vaultTracks}
      />
      {stage === "create" ? <MomentReviewPanel
        releaseId={snapshot.release.id}
        moments={snapshot.moments}
        historicalMoments={snapshot.historicalMoments}
        rawCandidateCount={snapshot.rawMomentCount}
        suppressedCount={snapshot.suppressedMomentCount}
        tracks={snapshot.tracks.map((track) => ({ id: track.id, title: track.title, audio_url: track.audio_url }))}
        performance={snapshot.momentPerformance}
        lyricSources={snapshot.lyricSources}
        calibrationEvents={snapshot.calibrationEvents}
      /> : null}
    </>;
  }

  return <>
    <div className="v2-advanced-banner">
      <div><strong>Specialist workspace</strong><span>Legacy controls for exceptional cases, migrations and debugging.</span></div>
      <Link className="button" href={scopedHref(`/studio/releases/${snapshot.release.id}`)}>Back to release</Link>
    </div>
    {tab === "campaign" ? <ReleaseCampaignBridge campaign={snapshot.campaign} /> : null}
    <ReleaseCockpit
      release={snapshot.release}
      tracks={snapshot.tracks}
      placement={snapshot.placement}
      mediaLinks={snapshot.mediaLinks}
      mediaAssets={snapshot.mediaAssets}
      mediaPreviewUrls={snapshot.mediaPreviewUrls}
      externalLinks={snapshot.externalLinks}
      externalTrackIds={snapshot.externalTrackIds}
      contentCount={snapshot.contentCount}
      contactCount={snapshot.contactCount}
      contentItems={snapshot.contentItems}
      metrics={snapshot.metrics}
      unmatchedSoundCloud={snapshot.relevantSoundCloud}
      unmatchedSpotify={snapshot.relevantSpotify}
      publicReleases={snapshot.publicReleases}
      videoProjects={snapshot.videoProjects}
      moments={snapshot.moments}
      tab={tab}
    />
  </>;
}
