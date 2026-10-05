import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadActiveVisualBrand } from "@/lib/brand/visual-brand-store";
import { createServiceClient } from "@/lib/supabase/service";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import type { ArtistScopedMusicDatabase } from "@/types/artist-scoped-music-database";
import type { MediaAsset } from "@/types/database";
import { asMomentAwareMarketingClient } from "@/lib/studio/moments-db";
import {
  defaultReleaseVisualMessage,
  deriveReleaseVisualStage,
  isReleaseVisualSpec,
  RELEASE_VISUAL_CANDIDATE_ROLE,
  RELEASE_VISUAL_FEED_ROLE,
  RELEASE_VISUAL_PRIMARY_ROLE,
  RELEASE_VISUAL_SOURCE_ROLE,
  RELEASE_VISUAL_SQUARE_ROLE,
  RELEASE_VISUAL_STORY_ROLE,
  type ReleaseVisualSpec,
} from "./release-visual";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseDraft(value: string | null): ReleaseVisualSpec | null {
  if (!value?.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value);
    return isReleaseVisualSpec(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function previewUrl(
  db: ReturnType<typeof createServiceClient>,
  asset: MediaAsset | null,
) {
  if (!asset) return null;
  if (asset.public_url) return asset.public_url;
  const { data, error } = await db.storage.from(asset.bucket_name)
    .createSignedUrl(asset.storage_path, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}

export async function loadReleaseVisualWorkspace(input: {
  ownerId: string;
  artistId: string;
  contentItemId: string;
}) {
  const service = createServiceClient();
  const marketing = asMomentAwareMarketingClient(service);
  const music = asArtistScopedMusicClient(service);
  const typedMusic = service as unknown as SupabaseClient<ArtistScopedMusicDatabase>;

  const { data: content, error: contentError } = await marketing.from("content_items")
    .select("*")
    .eq("id", input.contentItemId)
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .maybeSingle();
  if (contentError) throw new Error(contentError.message);
  if (!content?.release_id) throw new Error("Release Visual does not belong to an active release.");

  const [releaseResult, contentLinksResult, releaseLinksResult, brand] = await Promise.all([
    music.from("releases")
      .select("*")
      .eq("id", content.release_id)
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .maybeSingle(),
    typedMusic.from("media_links")
      .select("*")
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .eq("content_item_id", content.id)
      .order("created_at", { ascending: false }),
    typedMusic.from("media_links")
      .select("*")
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .eq("release_id", content.release_id)
      .order("created_at", { ascending: false }),
    loadActiveVisualBrand({
      db: service,
      ownerId: input.ownerId,
      artistId: input.artistId,
    }),
  ]);
  if (releaseResult.error) throw new Error(releaseResult.error.message);
  if (!releaseResult.data) throw new Error("Release not found for Release Visual.");
  if (contentLinksResult.error) throw new Error(contentLinksResult.error.message);
  if (releaseLinksResult.error) throw new Error(releaseLinksResult.error.message);

  const contentLinks = contentLinksResult.data ?? [];
  const releaseLinks = releaseLinksResult.data ?? [];
  const assetIds = [...new Set([...contentLinks, ...releaseLinks].map((link) => link.media_asset_id))];
  const { data: assets, error: assetsError } = assetIds.length
    ? await service.from("media_assets").select("*").eq("owner_id", input.ownerId).in("id", assetIds)
    : { data: [], error: null };
  if (assetsError) throw new Error(assetsError.message);
  const assetById = new Map((assets ?? []).map((asset) => [asset.id, asset]));

  const explicitSourceLink = contentLinks.find((link) =>
    link.role === RELEASE_VISUAL_SOURCE_ROLE && link.is_primary
  ) ?? contentLinks.find((link) => link.role === RELEASE_VISUAL_SOURCE_ROLE) ?? null;
  const coverLink = releaseLinks.find((link) => link.role === "cover" && link.is_primary)
    ?? releaseLinks.find((link) => link.role === "cover")
    ?? null;
  const explicitSourceAsset = explicitSourceLink
    ? assetById.get(explicitSourceLink.media_asset_id) ?? null
    : null;
  const coverAsset = coverLink ? assetById.get(coverLink.media_asset_id) ?? null : null;
  const selectedSourceAsset = explicitSourceAsset ?? coverAsset;
  const selectedSourceAssetUrl = await previewUrl(service, selectedSourceAsset ?? null);
  const release = releaseResult.data;
  const fallbackArtworkUrl = release.artwork_url
    || (typeof release.cover_asset === "string" && /^https?:///i.test(release.cover_asset) ? release.cover_asset : null);
  const sourceUrl = selectedSourceAssetUrl ?? fallbackArtworkUrl ?? null;

  const eligibleAssets = [...new Map(
    releaseLinks
      .map((link) => assetById.get(link.media_asset_id) ?? null)
      .filter((asset): asset is MediaAsset => Boolean(asset?.mime_type?.startsWith("image/")))
      .map((asset) => [asset.id, asset]),
  ).values()];
  const eligibleSources = await Promise.all(eligibleAssets.map(async (asset) => ({
    asset,
    url: await previewUrl(service, asset),
  })));

  const candidateLink = contentLinks.find((link) => link.role === RELEASE_VISUAL_CANDIDATE_ROLE) ?? null;
  const primaryLink = contentLinks.find((link) => link.role === RELEASE_VISUAL_PRIMARY_ROLE && link.is_primary)
    ?? contentLinks.find((link) => link.role === RELEASE_VISUAL_PRIMARY_ROLE)
    ?? null;
  const candidateAsset = candidateLink ? assetById.get(candidateLink.media_asset_id) ?? null : null;
  const primaryAsset = primaryLink ? assetById.get(primaryLink.media_asset_id) ?? null : null;

  const assetForRole = (role: string) => {
    const link = contentLinks.find((candidate) => candidate.role === role && candidate.is_primary)
      ?? contentLinks.find((candidate) => candidate.role === role);
    return link ? assetById.get(link.media_asset_id) ?? null : null;
  };

  const { data: generationRuns, error: runError } = await marketing.from("generation_runs")
    .select("*")
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .eq("purpose", `content_asset:${content.id}`)
    .order("created_at", { ascending: false })
    .limit(20);
  if (runError) throw new Error(runError.message);
  const approvedRun = (generationRuns ?? []).find((run) =>
    run.provider === "ensemblis-compositor"
    && run.model === "release-visual-v1"
    && run.status === "completed"
    && record(run.output).stage === "release_visual_approved"
  ) ?? null;

  const draftSpec = parseDraft(content.visual_prompt);
  const stage = deriveReleaseVisualStage({
    sourceReady: Boolean(sourceUrl),
    messageReady: Boolean(draftSpec),
    designReady: Boolean(candidateAsset),
    approved: Boolean(primaryAsset && content.approval_status === "approved"),
  });

  return {
    content,
    release,
    brand,
    stage,
    source: sourceUrl ? {
      assetId: selectedSourceAsset?.id ?? null,
      url: sourceUrl,
      width: selectedSourceAsset?.width ?? null,
      height: selectedSourceAsset?.height ?? null,
      label: explicitSourceAsset ? "Selected release visual" : "Release artwork",
    } : null,
    eligibleSources: eligibleSources.filter((item) => Boolean(item.url)),
    draftSpec,
    candidateAsset,
    candidateLink,
    primaryAsset,
    primaryLink,
    approvedRun,
    storyAsset: assetForRole(RELEASE_VISUAL_STORY_ROLE),
    feedAsset: assetForRole(RELEASE_VISUAL_FEED_ROLE),
    squareAsset: assetForRole(RELEASE_VISUAL_SQUARE_ROLE),
    recommendedMessage: defaultReleaseVisualMessage({
      releaseDate: release.release_date,
      status: release.status,
      isArchived: release.is_archived,
    }),
    generationRuns: generationRuns ?? [],
  };
}
