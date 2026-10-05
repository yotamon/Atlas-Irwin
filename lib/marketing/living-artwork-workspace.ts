import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createMarketingServiceClient } from "./db";
import { creativeProviderReadiness } from "./creative-providers";
import { loadCreativeReferenceContext } from "./creative-context";
import {
  deriveLivingArtworkStage,
  LIVING_ARTWORK_FULL_TRACK_ROLE,
  LIVING_ARTWORK_LOOP_ROLE,
  LIVING_ARTWORK_SOCIAL_ROLE,
} from "./living-artwork";
import { createServiceClient } from "@/lib/supabase/service";
import { asMomentAwareMarketingClient, asMomentsClient } from "@/lib/studio/moments-db";
import type { ArtistScopedMusicDatabase } from "@/types/artist-scoped-music-database";
import type { MarketingMediaDatabase, MarketingMediaJob } from "@/types/marketing-media-database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function loadLivingArtworkWorkspace(input: {
  ownerId: string;
  artistId: string;
  contentItemId: string;
}) {
  const service = createServiceClient();
  const marketing = asMomentAwareMarketingClient(service);
  const music = service as unknown as SupabaseClient<ArtistScopedMusicDatabase>;
  const mediaJobs = createMarketingServiceClient() as unknown as SupabaseClient<MarketingMediaDatabase>;

  const { data: content, error: contentError } = await marketing.from("content_items")
    .select("*")
    .eq("id", input.contentItemId)
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .maybeSingle();
  if (contentError) throw new Error(contentError.message);
  if (!content) throw new Error("Living Artwork content does not belong to the active artist.");

  const context = await loadCreativeReferenceContext({
    db: service,
    ownerId: input.ownerId,
    artistId: input.artistId,
    releaseId: content.release_id,
    contentItemId: content.id,
  });

  const sourceReference = context.imageReferences[0] ?? null;
  const sourceUrl = sourceReference?.url ?? context.release.artworkUrl ?? null;
  const sourceAssetId = sourceReference?.assetId ?? null;

  let track: { id: string; title: string; audio_url: string | null; duration: number | null } | null = null;
  if (content.moment_id) {
    const moments = asMomentsClient(service);
    const { data: moment, error: momentError } = await moments.from("moments")
      .select("track_id")
      .eq("id", content.moment_id)
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .maybeSingle();
    if (momentError) throw new Error(momentError.message);
    if (moment?.track_id) {
      const { data: selectedTrack, error: trackError } = await music.from("tracks")
        .select("id,title,audio_url,duration")
        .eq("id", moment.track_id)
        .eq("owner_id", input.ownerId)
        .eq("artist_id", input.artistId)
        .maybeSingle();
      if (trackError) throw new Error(trackError.message);
      track = selectedTrack;
    }
  }
  if (!track && content.release_id) {
    const { data: primaryTrack, error: trackError } = await music.from("tracks")
      .select("id,title,audio_url,duration")
      .eq("release_id", content.release_id)
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (trackError) throw new Error(trackError.message);
    track = primaryTrack;
  }

  const { data: links, error: linksError } = await music.from("media_links")
    .select("*")
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .eq("content_item_id", content.id)
    .in("role", [LIVING_ARTWORK_LOOP_ROLE, LIVING_ARTWORK_FULL_TRACK_ROLE, LIVING_ARTWORK_SOCIAL_ROLE])
    .order("created_at", { ascending: false });
  if (linksError) throw new Error(linksError.message);
  const assetIds = [...new Set((links ?? []).map((link) => link.media_asset_id))];
  const { data: assets, error: assetsError } = assetIds.length
    ? await service.from("media_assets").select("*").eq("owner_id", input.ownerId).in("id", assetIds)
    : { data: [], error: null };
  if (assetsError) throw new Error(assetsError.message);
  const assetById = new Map((assets ?? []).map((asset) => [asset.id, asset]));
  const loopLinks = (links ?? []).filter((link) => link.role === LIVING_ARTWORK_LOOP_ROLE);
  const approvedLoopLink = loopLinks.find((link) => link.is_primary) ?? null;
  const candidateLoopLink = approvedLoopLink ?? loopLinks[0] ?? null;
  const approvedLoopAsset = approvedLoopLink ? assetById.get(approvedLoopLink.media_asset_id) ?? null : null;
  const candidateLoopAsset = candidateLoopLink ? assetById.get(candidateLoopLink.media_asset_id) ?? null : null;
  const fullTrackLink = (links ?? []).find((link) => link.role === LIVING_ARTWORK_FULL_TRACK_ROLE && link.is_primary)
    ?? (links ?? []).find((link) => link.role === LIVING_ARTWORK_FULL_TRACK_ROLE)
    ?? null;
  const fullTrackAsset = fullTrackLink ? assetById.get(fullTrackLink.media_asset_id) ?? null : null;
  const socialLink = (links ?? []).find((link) => link.role === LIVING_ARTWORK_SOCIAL_ROLE) ?? null;
  const socialAsset = socialLink ? assetById.get(socialLink.media_asset_id) ?? null : null;

  const { data: jobs, error: jobsError } = await mediaJobs.from("marketing_media_jobs")
    .select("*")
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .eq("content_item_id", content.id)
    .in("job_type", ["normalize_loop_video", "render_loop_visualizer", "finish_social_video"])
    .order("created_at", { ascending: false })
    .limit(12);
  if (jobsError) throw new Error(jobsError.message);
  const mediaJobRows = (jobs ?? []) as MarketingMediaJob[];
  const activeJob = mediaJobRows.find((job) => ["planned", "queued", "running"].includes(job.status)) ?? null;

  const { data: generationRuns, error: generationError } = await marketing.from("generation_runs")
    .select("*")
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .eq("purpose", `content_asset:${content.id}`)
    .order("created_at", { ascending: false })
    .limit(6);
  if (generationError) throw new Error(generationError.message);
  const loopGeneration = (generationRuns ?? []).find((run) => record(run.input_context).creativeIntent === "seamless_loop") ?? null;

  const nativeLoopGenerationConfigured = creativeProviderReadiness()
    .some((provider) => provider.id === "higgsfield" && provider.configured);
  const latestFailedJob = mediaJobRows.find((job) => job.status === "failed") ?? null;

  const stage = deriveLivingArtworkStage({
    sourceReady: Boolean(sourceUrl),
    motionReady: Boolean(content.visual_prompt),
    processing: Boolean(activeJob) || Boolean(loopGeneration && ["queued", "running"].includes(loopGeneration.status)),
    rawLoopReady: Boolean(candidateLoopAsset),
    approvedLoopReady: Boolean(approvedLoopAsset),
  });

  return {
    content,
    context,
    source: sourceUrl ? {
      assetId: sourceAssetId,
      url: sourceUrl,
      label: sourceReference?.title || `${context.release.title} artwork`,
    } : null,
    track,
    stage,
    jobs: mediaJobRows,
    activeJob,
    loopGeneration,
    candidateLoopAsset,
    candidateLoopLink,
    approvedLoopAsset,
    approvedLoopLink,
    fullTrackAsset,
    socialAsset,
    nativeLoopGenerationConfigured,
    latestFailedJob,
  };
}
