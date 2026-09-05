import "server-only";

import { z } from "zod";
import { loadArtistCreativeMemory } from "@/lib/creative-memory/server";
import { MARKETING_OBJECTIVES } from "@/lib/marketing/domain";
import { finalizeCampaignIntelligence, selectMarketingMoments } from "@/lib/marketing/marketing-intelligence";
import { applyMarketingProductLayer } from "@/lib/marketing/marketing-intelligence-product-layer";
import { planCampaign, type CampaignPlanningContext } from "@/lib/marketing/planner";
import type { Json } from "@/types/database";
import { actionContext, brandRowText, marketingMoment, observedPerformance, previousCreativeRows, rejectionSignals, uuid, value } from "./marketing-intelligence-action-context";

const objectiveSchema = z.enum(MARKETING_OBJECTIVES);

function uniqueStrings(values: string[], limit = 30) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

export async function buildCampaignIntelligence(form: FormData) {
  const { supabase, user, artist, marketing, momentMarketing, moments, music, operational } = await actionContext(form);
  const campaignId = uuid.parse(value(form, "campaign_id"));
  const { data: campaign, error: campaignError } = await marketing.from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .single();
  if (campaignError) throw new Error(campaignError.message);
  if (!campaign.release_id) throw new Error("Campaign Intelligence requires a release-linked campaign.");

  const [releaseResult, brandResult, learningResult, legacyLearningResult, contentResult, metricResult, momentResult, rejectionResult] = await Promise.all([
    music.from("releases")
      .select("id,title,release_type,release_date,story,core_emotion,audience,primary_hook,visual_direction,genre,subgenre,release_identity,smart_link_url,spotify_url,soundcloud_url")
      .eq("id", campaign.release_id)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .single(),
    operational.from("brand_settings").select("section,content")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId),
    marketing.from("marketing_learnings").select("finding")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("status", "approved")
      .order("created_at", { ascending: false }).limit(40),
    operational.from("release_learnings").select("learning")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId)
      .order("created_at", { ascending: false }).limit(20),
    marketing.from("content_items").select("*")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId),
    marketing.from("metric_snapshots").select("*")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId),
    moments.from("moments")
      .select("id,label,moment_type,start_ms,end_ms,source_mode,purpose_tags,energy_score,hook_score,emotional_score,vocal_score,uniqueness_score,confidence,state")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("release_id", campaign.release_id)
      .eq("state", "approved"),
    marketing.from("marketing_events").select("payload")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId)
      .eq("event_type", "content.variant_rejected")
      .order("occurred_at", { ascending: false }).limit(50),
  ]);
  const firstError = [releaseResult, brandResult, learningResult, legacyLearningResult, contentResult, metricResult, momentResult, rejectionResult]
    .find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const release = releaseResult.data;
  if (!release) throw new Error("Campaign Intelligence could not load the linked release.");

  const objective = objectiveSchema.parse(campaign.objective);
  const creativeMemory = await loadArtistCreativeMemory({
    db: supabase,
    ownerId: user.id,
    artistId: artist.artistId,
    releaseId: release.id,
    recommendationLimit: 12,
  });
  const allContent = contentResult.data ?? [];
  const allMetrics = (metricResult.data ?? []) as unknown as Array<Record<string, unknown>>;
  const memorySemantic = uniqueStrings(creativeMemory.recommendations.flatMap((reference) => reference.semanticDescriptors), 24);
  const memoryVisual = uniqueStrings(creativeMemory.recommendations.flatMap((reference) => reference.visualDescriptors), 24);
  const brandContext = [
    ...(brandResult.data ?? []).map((row: { section: string; content: Json }) => brandRowText(row.section, row.content)).filter(Boolean),
    ...creativeMemory.preferences.positive.map((signal) => `Creative Memory preference: ${signal}`),
    ...memorySemantic.slice(0, 12).map((descriptor) => `Creative Memory semantic descriptor: ${descriptor}`),
    ...memoryVisual.slice(0, 12).map((descriptor) => `Creative Memory visual descriptor: ${descriptor}`),
  ];
  const approvedLearnings = [
    ...(learningResult.data ?? []).map((row: { finding: string }) => row.finding),
    ...(legacyLearningResult.data ?? []).map((row: { learning: string }) => row.learning),
    ...creativeMemory.preferences.positive.map((signal) => `Artist reinforced creative preference: ${signal}`),
  ].filter(Boolean).slice(0, 50);
  const rejections = uniqueStrings([
    ...rejectionSignals(rejectionResult.data ?? []),
    ...creativeMemory.preferences.negative.map((signal) => `Creative Memory rejection: ${signal}`),
  ], 40);
  const selectedMusicMoments = selectMarketingMoments(
    (momentResult.data ?? []).map((row) => {
      if (row.state !== "approved") {
        throw new Error("Campaign Intelligence received a non-approved Moment after approved-Moment filtering.");
      }
      return marketingMoment({ ...row, state: "approved" as const });
    }),
    5,
  );
  const performance = observedPerformance(allContent, allMetrics);
  const historicalCreative = previousCreativeRows(allContent, campaignId);
  const memoryCreative = creativeMemory.recommendations.map((reference) => ({
    title: reference.title,
    platform: "Creative Memory",
    format: reference.role,
    contentAngle: uniqueStrings([...reference.semanticDescriptors, ...reference.visualDescriptors], 18).join(" ") || null,
    hookText: reference.reasons.join(" ") || null,
    caption: reference.duplicateOfAssetId ? `Near-duplicate memory asset; canonical asset ${reference.duplicateOfAssetId} is preferred.` : null,
  }));
  const previousCreative = [...historicalCreative, ...memoryCreative].slice(-160);

  const planningContext: CampaignPlanningContext = {
    release,
    objective,
    brandContext: [
      ...brandContext,
      ...selectedMusicMoments.map((moment) => `Approved marketing Moment: ${moment.label} (${(moment.startMs / 1000).toFixed(2)}s–${(moment.endMs / 1000).toFixed(2)}s), ${moment.sourceMode}; ${moment.selectionReasons.join(" ")}`),
      ...rejections.map((signal) => `Do not repeat rejected direction: ${signal}`),
    ],
    approvedLearnings,
    performanceSummary: performance.plannerSummary,
  };
  const { plan, generation } = await planCampaign(planningContext, artist.artistId);
  const baseIntelligence = finalizeCampaignIntelligence({
    plan,
    artistName: artist.artistName,
    release: {
      title: release.title,
      story: release.story,
      core_emotion: release.core_emotion,
      audience: release.audience,
      primary_hook: release.primary_hook,
      visual_direction: release.visual_direction,
      genre: release.genre,
      subgenre: release.subgenre,
      release_identity: release.release_identity,
    },
    brandContext,
    approvedLearnings,
    normalizedPerformance: performance.normalized,
    selectedMusicMoments,
    previousCreative,
    rejectionSignals: rejections,
  });
  const intelligence = applyMarketingProductLayer({
    intelligence: baseIntelligence,
    objective,
    artistName: artist.artistName,
    release: {
      title: release.title,
      story: release.story,
      core_emotion: release.core_emotion,
      audience: release.audience,
      primary_hook: release.primary_hook,
      visual_direction: release.visual_direction,
      genre: release.genre,
      subgenre: release.subgenre,
    },
    brandContext,
    approvedLearnings,
    previousCreativeCount: historicalCreative.length,
    creativeMemory: {
      positivePreferences: creativeMemory.preferences.positive,
      negativePreferences: creativeMemory.preferences.negative,
      semanticDescriptors: memorySemantic,
      visualDescriptors: memoryVisual,
      recommendationCount: creativeMemory.recommendations.length,
    },
  });

  if (plan.contentMoments.length > 0 && intelligence.contentMoments.length === 0) {
    throw new Error(
      selectedMusicMoments.length
        ? "Campaign Intelligence rejected every candidate as generic, duplicated or insufficiently artist-specific. Improve the release identity or creative direction instead of publishing filler."
        : "Campaign Intelligence will not invent arbitrary music cuts. Approve at least one strong full Moment for this release before generating music-led social content.",
    );
  }

  return {
    user, artist, marketing, momentMarketing, campaignId, campaign, release, plan, generation, intelligence,
    planningContext, selectedMusicMoments, rejections,
  };
}
