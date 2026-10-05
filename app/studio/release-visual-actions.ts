"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { rankReleaseVisualLayouts } from "@/lib/marketing/release-visual-layout";
import { socialPlatformPackages } from "@/lib/marketing/platform-packages";
import {
  defaultReleaseVisualCopy,
  isReleaseVisualSpec,
  LIVING_ARTWORK_EXPLICIT_SOURCE_ROLE,
  RELEASE_VISUAL_CANDIDATE_ROLE,
  RELEASE_VISUAL_FEED_ROLE,
  RELEASE_VISUAL_LAYOUTS,
  RELEASE_VISUAL_MESSAGE_INTENTS,
  RELEASE_VISUAL_PACKAGE_IDS,
  RELEASE_VISUAL_PRIMARY_ROLE,
  RELEASE_VISUAL_SOURCE_ROLE,
  RELEASE_VISUAL_SQUARE_ROLE,
  RELEASE_VISUAL_STORY_ROLE,
  releaseVisualRoleForPackage,
  type ReleaseVisualLayoutId,
  type ReleaseVisualMessageIntent,
  type ReleaseVisualPackageId,
  type ReleaseVisualSpec,
} from "@/lib/marketing/release-visual";
import { loadReleaseVisualWorkspace } from "@/lib/marketing/release-visual-workspace";
import { asMarketingClient } from "@/lib/marketing/db";
import { resolveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";

const uuid = z.uuid();
const MAX_PNG_BYTES = 20 * 1024 * 1024;

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function nullable(form: FormData, key: string, fallback: string | null = null) {
  if (!form.has(key)) return fallback;
  const result = value(form, key);
  return result || null;
}

function json(value: unknown) {
  return value as Json;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function context(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artistId = uuid.parse(value(form, "artist_id"));
  const artist = await resolveArtistContext(supabase, user, artistId);
  const contentItemId = uuid.parse(value(form, "content_item_id"));
  return { supabase, artist, contentItemId };
}

function refresh(contentItemId: string, releaseId?: string | null) {
  revalidatePath(`/studio/create/visual/${contentItemId}`);
  revalidatePath("/studio");
  revalidatePath("/studio/production");
  revalidatePath("/studio/library");
  if (releaseId) revalidatePath(`/studio/releases/${releaseId}`);
}

function packageById(id: string) {
  const target = socialPlatformPackages().find((item) =>
    item.id === id && item.outputKind === "image"
  );
  if (!target) throw new Error("Choose a supported static social format.");
  return target;
}

function pngDimensions(bytes: Buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error("Release Visual exports must be valid PNG images.");
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

async function setPrimaryRole(input: {
  ownerId: string;
  artistId: string;
  releaseId: string;
  contentItemId: string;
  mediaAssetId: string;
  role: string;
  caption: string;
}) {
  const service = createServiceClient();
  const music = asArtistScopedMusicClient(service);
  const { error: demoteError } = await music.from("media_links").update({ is_primary: false })
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .eq("content_item_id", input.contentItemId)
    .eq("role", input.role);
  if (demoteError) throw new Error(demoteError.message);

  const { data: existing, error: lookupError } = await music.from("media_links")
    .select("id")
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .eq("content_item_id", input.contentItemId)
    .eq("media_asset_id", input.mediaAssetId)
    .eq("role", input.role)
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);

  const row = {
    owner_id: input.ownerId,
    artist_id: input.artistId,
    media_asset_id: input.mediaAssetId,
    release_id: input.releaseId,
    track_id: null,
    content_item_id: input.contentItemId,
    role: input.role,
    display_order: 0,
    is_primary: true,
    caption: input.caption,
    alt_text: null,
  };
  const { error } = existing
    ? await music.from("media_links").update(row)
      .eq("id", existing.id)
      .eq("artist_id", input.artistId)
    : await music.from("media_links").insert(row);
  if (error) throw new Error(error.message);
}

async function clearRenderedSelection(input: {
  ownerId: string;
  artistId: string;
  contentItemId: string;
}) {
  const service = createServiceClient();
  const music = asArtistScopedMusicClient(service);
  const roles = [
    RELEASE_VISUAL_CANDIDATE_ROLE,
    RELEASE_VISUAL_PRIMARY_ROLE,
    RELEASE_VISUAL_STORY_ROLE,
    RELEASE_VISUAL_FEED_ROLE,
    RELEASE_VISUAL_SQUARE_ROLE,
    LIVING_ARTWORK_EXPLICIT_SOURCE_ROLE,
  ];
  const { error } = await music.from("media_links").update({ is_primary: false })
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .eq("content_item_id", input.contentItemId)
    .in("role", roles);
  if (error) throw new Error(error.message);
}

export async function selectReleaseVisualSource(form: FormData) {
  const { artist, contentItemId } = await context(form);
  const workspace = await loadReleaseVisualWorkspace({
    ownerId: artist.userId,
    artistId: artist.artistId,
    contentItemId,
  });
  const requestedAssetId = value(form, "source_asset_id");
  const service = createServiceClient();
  const marketing = asMarketingClient(service);
  const music = asArtistScopedMusicClient(service);

  const { error: demoteError } = await music.from("media_links").update({ is_primary: false })
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .eq("content_item_id", contentItemId)
    .eq("role", RELEASE_VISUAL_SOURCE_ROLE);
  if (demoteError) throw new Error(demoteError.message);

  if (requestedAssetId) {
    const selected = workspace.eligibleSources.find((item) => item.asset.id === requestedAssetId);
    if (!selected) throw new Error("Choose a visual already linked to this release.");
    await setPrimaryRole({
      ownerId: artist.userId,
      artistId: artist.artistId,
      releaseId: workspace.release.id,
      contentItemId,
      mediaAssetId: selected.asset.id,
      role: RELEASE_VISUAL_SOURCE_ROLE,
      caption: "Selected Release Visual source",
    });
  }

  await clearRenderedSelection({
    ownerId: artist.userId,
    artistId: artist.artistId,
    contentItemId,
  });
  const { error: resetError } = await marketing.from("content_items").update({
    visual_prompt: null,
    asset_url: null,
    approval_status: "not_required",
    generated_from_run_id: null,
  }).eq("id", contentItemId)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId);
  if (resetError) throw new Error(resetError.message);

  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    campaign_id: workspace.content.campaign_id,
    event_type: "release_visual_source_selected",
    entity_type: "content_item",
    entity_id: contentItemId,
    payload: json({
      releaseId: workspace.release.id,
      sourceKind: requestedAssetId ? "release_media_asset" : "release_cover",
    }),
  });
  if (eventError) throw new Error(eventError.message);
  refresh(contentItemId, workspace.release.id);
}

export async function saveReleaseVisualMessage(form: FormData) {
  const { artist, contentItemId } = await context(form);
  const workspace = await loadReleaseVisualWorkspace({
    ownerId: artist.userId,
    artistId: artist.artistId,
    contentItemId,
  });
  if (!workspace.source) throw new Error("Choose release artwork before writing the visual message.");

  const requestedIntent = value(form, "message_intent") as ReleaseVisualMessageIntent;
  if (!RELEASE_VISUAL_MESSAGE_INTENTS.includes(requestedIntent)) {
    throw new Error("Choose a valid Release Visual message.");
  }
  const packageId = (value(form, "package_id") || "instagram-story-image") as ReleaseVisualPackageId;
  if (!RELEASE_VISUAL_PACKAGE_IDS.includes(packageId)) throw new Error("Choose a supported social format.");
  const target = packageById(packageId);
  const layouts = rankReleaseVisualLayouts({
    target,
    brand: workspace.brand?.dna ?? null,
    messageIntent: requestedIntent,
  });
  const requestedLayout = value(form, "layout") as ReleaseVisualLayoutId;
  const layout = RELEASE_VISUAL_LAYOUTS.includes(requestedLayout)
    ? requestedLayout
    : layouts[0];

  const defaults = defaultReleaseVisualCopy({
    intent: requestedIntent,
    releaseTitle: workspace.release.title,
    artistName: artist.artistName,
    releaseDate: workspace.release.release_date,
  });
  const copy = {
    eyebrow: nullable(form, "eyebrow", defaults.eyebrow),
    headline: nullable(form, "headline", defaults.headline),
    title: nullable(form, "title", defaults.title),
    artistName: nullable(form, "artist_name", defaults.artistName),
    dateLabel: nullable(form, "date_label", defaults.dateLabel),
    supportingLine: nullable(form, "supporting_line", defaults.supportingLine),
    cta: nullable(form, "cta", defaults.cta),
  };

  const spec: ReleaseVisualSpec = {
    version: 1,
    artistId: artist.artistId,
    releaseId: workspace.release.id,
    contentItemId,
    sourceAssetId: workspace.source.assetId,
    sourceUrl: workspace.source.url,
    messageIntent: requestedIntent,
    copy,
    layout,
    primaryPackageId: packageId,
    visualBrandVersionId: workspace.brand?.id ?? null,
    visualBrandFingerprint: workspace.brand
      ? `${workspace.brand.id}:v${workspace.brand.version}`
      : null,
    backgroundTreatment: layout === "full_bleed"
      ? "full_bleed"
      : layout === "minimal_frame"
        ? "solid"
        : "extended_blur",
    textTreatment: {
      family: "display",
      weight: copy.headline ? "bold" : "medium",
      case: copy.headline ? "uppercase" : "original",
      align: layout === "editorial_split" || layout === "full_bleed" ? "left" : "center",
    },
  };

  const service = createServiceClient();
  const marketing = asMarketingClient(service);
  await clearRenderedSelection({
    ownerId: artist.userId,
    artistId: artist.artistId,
    contentItemId,
  });
  const { error: updateError } = await marketing.from("content_items").update({
    visual_prompt: JSON.stringify(spec),
    hook_text: spec.copy.headline,
    cta: spec.copy.cta,
    format: target.format,
    asset_url: null,
    approval_status: "not_required",
    generated_from_run_id: null,
  }).eq("id", contentItemId)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId);
  if (updateError) throw new Error(updateError.message);

  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    campaign_id: workspace.content.campaign_id,
    event_type: "release_visual_message_selected",
    entity_type: "content_item",
    entity_id: contentItemId,
    payload: json({
      releaseId: workspace.release.id,
      messageIntent: spec.messageIntent,
      layout: spec.layout,
      packageId: spec.primaryPackageId,
      zeroSpend: true,
    }),
  });
  if (eventError) throw new Error(eventError.message);
  refresh(contentItemId, workspace.release.id);
}

function validatedSpec(input: {
  raw: string;
  workspace: Awaited<ReturnType<typeof loadReleaseVisualWorkspace>>;
  artistId: string;
  contentItemId: string;
}) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.raw);
  } catch {
    throw new Error("Release Visual composition spec is invalid.");
  }
  if (!isReleaseVisualSpec(parsed)) throw new Error("Release Visual composition spec is incomplete.");
  const spec = parsed as ReleaseVisualSpec;
  if (spec.artistId !== input.artistId
    || spec.releaseId !== input.workspace.release.id
    || spec.contentItemId !== input.contentItemId) {
    throw new Error("Release Visual composition belongs to another context.");
  }
  if (!input.workspace.source
    || spec.sourceUrl !== input.workspace.source.url
    || spec.sourceAssetId !== input.workspace.source.assetId) {
    throw new Error("Release Visual source changed. Review the composition again.");
  }
  if (!RELEASE_VISUAL_PACKAGE_IDS.includes(spec.primaryPackageId)) {
    throw new Error("Release Visual target package is unsupported.");
  }
  return spec;
}

export async function saveReleaseVisualCandidate(form: FormData) {
  const { artist, contentItemId } = await context(form);
  const workspace = await loadReleaseVisualWorkspace({
    ownerId: artist.userId,
    artistId: artist.artistId,
    contentItemId,
  });
  const spec = validatedSpec({
    raw: value(form, "spec_json"),
    workspace,
    artistId: artist.artistId,
    contentItemId,
  });
  const file = form.get("rendered_png");
  if (!(file instanceof File) || file.size <= 0) throw new Error("Render the Release Visual before review.");
  if (file.size > MAX_PNG_BYTES) throw new Error("Release Visual PNG must be under 20 MB.");
  if (file.type.toLowerCase() !== "image/png") throw new Error("Release Visual exports must be PNG.");

  const bytes = Buffer.from(await file.arrayBuffer());
  const dimensions = pngDimensions(bytes);
  const target = packageById(spec.primaryPackageId);
  if (dimensions.width !== target.width || dimensions.height !== target.height) {
    throw new Error(`Release Visual must be exactly ${target.width}×${target.height} for ${target.id}.`);
  }

  const hash = createHash("sha256").update(bytes).digest("hex");
  const specFingerprint = createHash("sha256").update(JSON.stringify(spec)).digest("hex");
  const service = createServiceClient();
  const bucket = "public-media";
  const path = `${artist.userId}/library/marketing/${artist.artistId}/release-visual/${contentItemId}/${target.id}/${hash}.png`;
  const publicUrl = service.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  const { error: uploadError } = await service.storage.from(bucket).upload(path, bytes, {
    contentType: "image/png",
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError && !/already exists/i.test(uploadError.message)) throw new Error(uploadError.message);

  const { data: existingAsset, error: lookupError } = await service.from("media_assets")
    .select("*")
    .eq("owner_id", artist.userId)
    .eq("storage_path", path)
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);

  let asset = existingAsset;
  if (!asset) {
    const { data, error } = await service.from("media_assets").insert({
      owner_id: artist.userId,
      bucket_name: bucket,
      storage_path: path,
      public_url: publicUrl,
      asset_type: "social_image",
      mime_type: "image/png",
      file_size: bytes.length,
      content_hash: hash,
      width: target.width,
      height: target.height,
      duration_ms: null,
      visibility: "public",
      metadata: json({
        title: `${workspace.release.title} · ${target.format} Release Visual`,
        description: "Deterministic Release Visual candidate composed from approved release identity.",
        tags: [`artist:${artist.artistId}`, "release-visual", target.id, "deterministic"],
        artist_id: artist.artistId,
        release_id: workspace.release.id,
        content_item_id: contentItemId,
        source_asset_id: spec.sourceAssetId,
        source_url: spec.sourceUrl,
        release_visual_spec: spec,
        spec_fingerprint: specFingerprint,
        package_id: target.id,
        compositor_version: "release-visual-v1",
        upload_source: "release-visual-browser-compositor",
        zero_generation_spend: true,
      }),
    }).select("*").single();
    if (error || !data) throw new Error(error?.message || "Release Visual candidate could not be registered.");
    asset = data;
  }

  await setPrimaryRole({
    ownerId: artist.userId,
    artistId: artist.artistId,
    releaseId: workspace.release.id,
    contentItemId,
    mediaAssetId: asset.id,
    role: RELEASE_VISUAL_CANDIDATE_ROLE,
    caption: `${target.format} Release Visual · awaiting approval`,
  });

  const marketing = asMarketingClient(service);
  const { error: updateError } = await marketing.from("content_items").update({
    visual_prompt: JSON.stringify(spec),
    hook_text: spec.copy.headline,
    cta: spec.copy.cta,
    format: target.format,
    asset_url: null,
    approval_status: "pending",
  }).eq("id", contentItemId)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId);
  if (updateError) throw new Error(updateError.message);

  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    campaign_id: workspace.content.campaign_id,
    event_type: "release_visual_rendered",
    entity_type: "content_item",
    entity_id: contentItemId,
    payload: json({
      releaseId: workspace.release.id,
      messageIntent: spec.messageIntent,
      layout: spec.layout,
      packageId: target.id,
      zeroSpend: true,
      specFingerprint,
    }),
  });
  if (eventError) throw new Error(eventError.message);
  refresh(contentItemId, workspace.release.id);
}

export async function approveReleaseVisual(form: FormData) {
  const { artist, contentItemId } = await context(form);
  const workspace = await loadReleaseVisualWorkspace({
    ownerId: artist.userId,
    artistId: artist.artistId,
    contentItemId,
  });
  const assetId = uuid.parse(value(form, "media_asset_id"));
  if (!workspace.candidateAsset || workspace.candidateAsset.id !== assetId || !workspace.candidateAsset.public_url) {
    throw new Error("Review the current Release Visual candidate before approving it.");
  }

  const metadata = record(workspace.candidateAsset.metadata);
  const specValue = metadata.release_visual_spec;
  if (!isReleaseVisualSpec(specValue)) throw new Error("Release Visual candidate is missing its composition spec.");
  const spec = specValue as ReleaseVisualSpec;
  const target = packageById(spec.primaryPackageId);
  const specFingerprint = typeof metadata.spec_fingerprint === "string"
    ? metadata.spec_fingerprint
    : createHash("sha256").update(JSON.stringify(spec)).digest("hex");

  const service = createServiceClient();
  const marketing = asMarketingClient(service);
  const { data: runs, error: runsError } = await marketing.from("generation_runs")
    .select("*")
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .eq("purpose", `content_asset:${contentItemId}`)
    .eq("provider", "ensemblis-compositor")
    .eq("model", "release-visual-v1")
    .order("created_at", { ascending: false })
    .limit(20);
  if (runsError) throw new Error(runsError.message);
  let run = (runs ?? []).find((candidate) => record(candidate.output).mediaAssetId === assetId) ?? null;

  if (!run) {
    const now = new Date().toISOString();
    const { data, error } = await marketing.from("generation_runs").insert({
      owner_id: artist.userId,
      artist_id: artist.artistId,
      campaign_id: workspace.content.campaign_id,
      release_id: workspace.release.id,
      parent_run_id: null,
      purpose: `content_asset:${contentItemId}`,
      task_type: "release_visual_compose",
      provider: "ensemblis-compositor",
      model: "release-visual-v1",
      requested_model: "release-visual-v1",
      routed_provider: "ensemblis-compositor",
      gateway_generation_id: null,
      prompt_version: "release-visual-v1",
      input_context: json({
        artistId: artist.artistId,
        contentItemId,
        releaseVisualSpec: spec,
        sourceAssetId: spec.sourceAssetId,
        sourceUrl: spec.sourceUrl,
        package: target,
        visualBrandVersionId: spec.visualBrandVersionId,
        zeroGenerationSpend: true,
      }),
      output: json({
        stage: "release_visual_approved",
        resultUrl: workspace.candidateAsset.public_url,
        mediaAssetId: assetId,
        releaseVisualSpec: spec,
        visualQuality: {
          passed: true,
          deterministic: true,
          dimensions: { width: target.width, height: target.height },
          safeAreaValidated: true,
        },
      }),
      status: "completed",
      attempt_index: 0,
      started_at: now,
      completed_at: now,
      latency_ms: 0,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
      actual_cost_usd: 0,
      fallback_used: false,
      fallback_count: 0,
      escalated: false,
      quality_gate_passed: true,
      quality_score: 1,
      quality_failures: json([]),
      metadata: json({
        artistId: artist.artistId,
        specFingerprint,
        compositorVersion: "release-visual-v1",
        zeroGenerationSpend: true,
      }),
      error: null,
    }).select("*").single();
    if (error || !data) throw new Error(error?.message || "Could not record Release Visual approval lineage.");
    run = data;
  }

  await setPrimaryRole({
    ownerId: artist.userId,
    artistId: artist.artistId,
    releaseId: workspace.release.id,
    contentItemId,
    mediaAssetId: assetId,
    role: releaseVisualRoleForPackage(spec.primaryPackageId),
    caption: `Approved ${target.format} Release Visual`,
  });
  await setPrimaryRole({
    ownerId: artist.userId,
    artistId: artist.artistId,
    releaseId: workspace.release.id,
    contentItemId,
    mediaAssetId: assetId,
    role: RELEASE_VISUAL_PRIMARY_ROLE,
    caption: "Approved primary Release Visual",
  });

  const { error: contentError } = await marketing.from("content_items").update({
    visual_prompt: JSON.stringify(spec),
    asset_url: workspace.candidateAsset.public_url,
    format: target.format,
    approval_status: "approved",
    generated_from_run_id: run.id,
  }).eq("id", contentItemId)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId);
  if (contentError) throw new Error(contentError.message);

  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    campaign_id: workspace.content.campaign_id,
    event_type: "release_visual_approved",
    entity_type: "content_item",
    entity_id: contentItemId,
    payload: json({
      releaseId: workspace.release.id,
      messageIntent: spec.messageIntent,
      layout: spec.layout,
      packageId: spec.primaryPackageId,
      zeroSpend: true,
      visualBrandVersionId: spec.visualBrandVersionId,
    }),
  });
  if (eventError) throw new Error(eventError.message);
  refresh(contentItemId, workspace.release.id);
}
