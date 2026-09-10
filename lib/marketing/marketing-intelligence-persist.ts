import "server-only";

import { revalidatePath } from "next/cache";
import { OBJECTIVE_KPIS, type MarketingObjective } from "./domain";
import { releaseRelativeTimestamp } from "./schedule";
import { attributionCode, json } from "./marketing-intelligence-action-context";
import type { buildCampaignIntelligence } from "./marketing-intelligence-build";

type BuiltCampaignIntelligence = Awaited<ReturnType<typeof buildCampaignIntelligence>>;

export async function persistCampaignIntelligence(built: BuiltCampaignIntelligence) {
  const {
    user, artist, marketing, momentMarketing, campaignId, campaign, release,
    generation, planningContext, intelligence, selectedMusicMoments,
  } = built;

  // Snapshot the currently active replaceable plan. The old plan remains intact while the
  // new plan is staged, so a failed insert cannot destroy the artist's current campaign work.
  const [replaceableResult, replaceableExperimentResult, previousMomentResult] = await Promise.all([
    marketing.from("content_items")
      .select("id")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("campaign_id", campaignId)
      .in("source", ["planner", "ai"])
      .in("status", ["Idea", "Draft", "In Production", "Ready"]),
    marketing.from("campaign_experiments")
      .select("id")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("campaign_id", campaignId)
      .eq("status", "planned"),
    momentMarketing.from("campaign_moments")
      .select("moment_id,role,is_active")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("campaign_id", campaignId),
  ]);
  const snapshotError = [replaceableResult, replaceableExperimentResult, previousMomentResult]
    .find((result) => result.error)?.error;
  if (snapshotError) throw new Error(snapshotError.message);

  const replaceableItemIds = (replaceableResult.data ?? []).map((item) => item.id);
  const replaceableExperimentIds = (replaceableExperimentResult.data ?? []).map((experiment) => experiment.id);
  const previousMoments = previousMomentResult.data ?? [];

  let generationRun: { id: string };
  const controlPlaneRunId = "runId" in generation && typeof generation.runId === "string" ? generation.runId : null;
  if (controlPlaneRunId) {
    const { data, error } = await marketing.from("generation_runs").update({
      campaign_id: campaignId,
      release_id: campaign.release_id,
      input_context: json(planningContext),
      output: json(intelligence),
    }).eq("id", controlPlaneRunId).eq("owner_id", user.id).eq("artist_id", artist.artistId)
      .select("id").single();
    if (error || !data) throw new Error(error?.message || "Campaign Intelligence generation run could not be linked.");
    generationRun = data;
  } else {
    const { data, error } = await marketing.from("generation_runs").insert({
      owner_id: user.id,
      artist_id: artist.artistId,
      campaign_id: campaignId,
      release_id: campaign.release_id,
      purpose: "campaign_plan",
      task_type: "marketing.campaign_plan",
      provider: generation.provider,
      model: generation.model,
      requested_model: generation.model,
      prompt_version: "marketing-intelligence-v2",
      input_context: json(planningContext),
      output: json(intelligence),
      status: "completed",
      quality_gate_passed: generation.provider === "template" ? null : true,
      user_outcome: "unknown",
      completed_at: new Date().toISOString(),
    }).select("id").single();
    if (error || !data) throw new Error(error?.message || "Campaign Intelligence generation run could not be saved.");
    generationRun = data;
  }

  const { data: phases, error: phaseError } = await marketing.from("campaign_phases")
    .select("id,code").eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("campaign_id", campaignId);
  if (phaseError) throw new Error(phaseError.message);
  const phaseByCode = new Map((phases ?? []).map((phase) => [phase.code, phase.id]));

  const experimentRows = intelligence.experiments.map((experiment) => ({
    owner_id: user.id,
    artist_id: artist.artistId,
    campaign_id: campaignId,
    phase_id: phaseByCode.get(experiment.phaseCode) ?? null,
    title: experiment.title,
    hypothesis: experiment.hypothesis,
    goal: experiment.goal,
    primary_metric: experiment.primaryMetric,
    status: "planned" as const,
  }));
  const experiments = experimentRows.length
    ? await marketing.from("campaign_experiments").insert(experimentRows).select("id,title")
    : { data: [], error: null };
  if (experiments.error) throw new Error(experiments.error.message);

  const stagedExperimentIds = (experiments.data ?? []).map((experiment) => experiment.id);
  const stagedContentIds: string[] = [];
  const experimentByTitle = new Map((experiments.data ?? []).map((experiment) => [experiment.title, experiment.id]));
  const experimentPlanByTitle = new Map(intelligence.experiments.map((experiment) => [experiment.title, experiment]));
  const selectedMomentById = new Map(selectedMusicMoments.map((moment) => [moment.id, moment]));
  const destinationUrl = release.smart_link_url || release.spotify_url || release.soundcloud_url;
  const source = generation.provider === "template" ? "planner" : "ai";

  async function rollbackStagedPlan() {
    if (stagedContentIds.length) {
      await marketing.from("attribution_links")
        .delete().eq("owner_id", user.id).eq("artist_id", artist.artistId).in("content_item_id", stagedContentIds);
      await marketing.from("content_variants")
        .delete().eq("owner_id", user.id).eq("artist_id", artist.artistId).in("content_item_id", stagedContentIds);
      await momentMarketing.from("content_items")
        .delete().eq("owner_id", user.id).eq("artist_id", artist.artistId).in("id", stagedContentIds);
    }
    if (stagedExperimentIds.length) {
      await marketing.from("campaign_experiments")
        .delete().eq("owner_id", user.id).eq("artist_id", artist.artistId).in("id", stagedExperimentIds);
    }
  }

  async function restorePreviousMoments() {
    await momentMarketing.from("campaign_moments")
      .delete().eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("campaign_id", campaignId);
    if (previousMoments.length) {
      await momentMarketing.from("campaign_moments").insert(previousMoments.map((moment) => ({
        owner_id: user.id,
        artist_id: artist.artistId,
        campaign_id: campaignId,
        moment_id: moment.moment_id,
        role: moment.role,
        is_active: moment.is_active,
      })));
    }
  }

  try {
    // Stage every new content item, variant and attribution link before touching the active plan.
    for (const item of intelligence.contentMoments) {
      const experimentId = item.experimentTitle ? experimentByTitle.get(item.experimentTitle) ?? null : null;
      const experimentPlan = item.experimentTitle ? experimentPlanByTitle.get(item.experimentTitle) : undefined;
      const firstVariant = experimentPlan?.variants[0];
      const musicMoment = item.musicMomentId ? selectedMomentById.get(item.musicMomentId) ?? null : null;
      const scheduledAt = releaseRelativeTimestamp(release.release_date, item.relativeDay);
      const card = intelligence.productionCards.find((candidate) => candidate.contentTitle === item.title && candidate.platform === item.platform);

      const { data: contentItem, error: contentError } = await momentMarketing.from("content_items").insert({
        owner_id: user.id,
        artist_id: artist.artistId,
        release_id: release.id,
        campaign_id: campaignId,
        phase_id: phaseByCode.get(item.phaseCode) ?? null,
        experiment_id: experimentId,
        title: item.title,
        platform: item.platform,
        format: item.format,
        status: "Draft",
        goal: item.goal,
        scheduled_at: scheduledAt,
        published_at: null,
        approval_status: "pending",
        source,
        generated_from_run_id: generationRun.id,
        content_angle: item.contentAngle,
        audience_segment: item.audienceSegment,
        relative_day: item.relativeDay,
        schedule_locked: false,
        schedule_local_time: "18:00:00",
        schedule_timezone: "Europe/Berlin",
        hook_text: firstVariant?.hookText ?? item.contentAngle,
        caption: firstVariant?.caption ?? null,
        cta: firstVariant?.cta ?? null,
        visual_prompt: firstVariant?.visualPrompt ?? release.visual_direction,
        production_notes: card
          ? [card.audioIntegrityRule, card.sourcePlan, ...card.shotList].join("\n")
          : firstVariant?.productionNotes ?? `Campaign brief: ${item.contentAngle}.`,
        moment_id: musicMoment?.id ?? null,
        // Exact boundaries remain canonical on the approved Moment in milliseconds.
        // The DB trigger derives legacy coarse seconds when moment_id is attached.
        audio_timestamp_start: null,
        audio_timestamp_end: null,
      }).select("id").single();
      if (contentError) throw new Error(contentError.message);
      stagedContentIds.push(contentItem.id);

      if (experimentId && experimentPlan) {
        const variantRows = experimentPlan.variants.slice(0, 2).map((variant, index) => ({
          owner_id: user.id,
          artist_id: artist.artistId,
          content_item_id: contentItem.id,
          experiment_id: experimentId,
          generation_run_id: generationRun.id,
          label: variant.label,
          hypothesis: experimentPlan.hypothesis,
          hook_text: variant.hookText,
          caption: variant.caption,
          cta: variant.cta,
          visual_prompt: variant.visualPrompt,
          production_notes: variant.productionNotes,
          status: "draft" as const,
          approval_status: "pending" as const,
          is_control: index === 0,
          scheduled_at: scheduledAt,
          attribution_code: destinationUrl ? attributionCode() : null,
        }));
        const { data: variants, error: variantError } = await marketing.from("content_variants")
          .insert(variantRows).select("id,label,attribution_code");
        if (variantError) throw new Error(variantError.message);
        if (destinationUrl && variants?.length) {
          const { error: linkError } = await marketing.from("attribution_links").insert(
            variants.filter((variant) => variant.attribution_code).map((variant) => ({
              owner_id: user.id,
              artist_id: artist.artistId,
              campaign_id: campaignId,
              content_item_id: contentItem.id,
              content_variant_id: variant.id,
              code: variant.attribution_code!,
              platform: item.platform,
              destination_url: destinationUrl,
              label: `${item.title} / ${variant.label}`,
            })),
          );
          if (linkError) throw new Error(linkError.message);
        }
      } else if (destinationUrl) {
        const { error: linkError } = await marketing.from("attribution_links").insert({
          owner_id: user.id,
          artist_id: artist.artistId,
          campaign_id: campaignId,
          content_item_id: contentItem.id,
          content_variant_id: null,
          code: attributionCode(),
          platform: item.platform,
          destination_url: destinationUrl,
          label: item.title,
        });
        if (linkError) throw new Error(linkError.message);
      }
    }

    // Commit the new Moment lineage only after the whole content graph is staged.
    const { error: clearMomentsError } = await momentMarketing.from("campaign_moments")
      .delete().eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("campaign_id", campaignId);
    if (clearMomentsError) throw new Error(clearMomentsError.message);
    if (selectedMusicMoments.length) {
      const { error: campaignMomentError } = await momentMarketing.from("campaign_moments").insert(
        selectedMusicMoments.map((moment, index) => ({
          owner_id: user.id,
          artist_id: artist.artistId,
          campaign_id: campaignId,
          moment_id: moment.id,
          role: index === 0 ? "primary" as const : "supporting" as const,
          is_active: true,
        })),
      );
      if (campaignMomentError) throw new Error(campaignMomentError.message);
    }

    const objective = campaign.objective as MarketingObjective;
    const kpis = OBJECTIVE_KPIS[objective];
    const { error: campaignUpdateError } = await marketing.from("campaigns").update({
      status: campaign.status === "active" ? "active" : "planned",
      primary_kpi: kpis.primary,
      secondary_kpis: kpis.secondary,
      audience_segments: json(intelligence.audienceSegments),
      strategy: json({
        planVersion: intelligence.version,
        generatedAt: new Date().toISOString(),
        provider: generation.provider,
        model: generation.model,
        strategySummary: intelligence.strategySummary,
        contentPillars: intelligence.contentPillars,
        learningsApplied: intelligence.learningsApplied,
        artistMarketingDna: intelligence.artistMarketingDna,
        funnelStrategy: intelligence.funnelStrategy,
        platformDirectors: intelligence.platformDirectors,
        productionCards: intelligence.productionCards,
        selectedMusicMoments: intelligence.selectedMusicMoments,
        normalizedPerformance: intelligence.normalizedPerformance,
        rejectionSignals: intelligence.rejectionSignals,
        qualitySummary: intelligence.qualitySummary,
      }),
    }).eq("id", campaignId).eq("owner_id", user.id).eq("artist_id", artist.artistId);
    if (campaignUpdateError) throw new Error(campaignUpdateError.message);
  } catch (error) {
    // Until the campaign pointer is committed, failure means the staged plan is disposable.
    try { await restorePreviousMoments(); } catch (restoreError) {
      console.error("Could not restore previous Campaign Moment lineage after failed intelligence refresh:", restoreError);
    }
    try { await rollbackStagedPlan(); } catch (rollbackError) {
      console.error("Could not fully clean staged Campaign Intelligence rows:", rollbackError);
    }
    throw error;
  }

  // The new plan is now active. Cleanup is deliberately last so an insert failure can never erase
  // the old artist work. A cleanup failure can leave redundant draft rows, but cannot lose the new plan.
  const cleanupWarnings: string[] = [];
  if (replaceableItemIds.length) {
    const { error: deleteError } = await marketing.from("content_items")
      .delete().eq("owner_id", user.id).eq("artist_id", artist.artistId).in("id", replaceableItemIds);
    if (deleteError) {
      cleanupWarnings.push("Previous replaceable content could not be fully removed after the new plan committed.");
      console.error("Campaign Intelligence previous content cleanup failed:", deleteError.message);
    }
  }
  if (replaceableExperimentIds.length) {
    const { error: experimentDeleteError } = await marketing.from("campaign_experiments")
      .delete().eq("owner_id", user.id).eq("artist_id", artist.artistId).in("id", replaceableExperimentIds);
    if (experimentDeleteError) {
      cleanupWarnings.push("Previous planned experiments could not be fully removed after the new plan committed.");
      console.error("Campaign Intelligence previous experiment cleanup failed:", experimentDeleteError.message);
    }
  }

  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: user.id,
    artist_id: artist.artistId,
    campaign_id: campaignId,
    event_type: "campaign.intelligence_refreshed",
    entity_type: "campaign",
    entity_id: campaignId,
    payload: json({
      generationRunId: generationRun.id,
      provider: generation.provider,
      model: generation.model,
      selected: intelligence.qualitySummary.selected,
      rejected: intelligence.qualitySummary.rejected,
      averagePublishability: intelligence.qualitySummary.averagePublishability,
      selectedMomentIds: selectedMusicMoments.map((moment) => moment.id),
      replacementMode: "staged_then_commit",
      cleanupWarnings,
    }),
  });
  if (eventError) {
    cleanupWarnings.push("Refresh telemetry could not be recorded after the new plan committed.");
    console.error("Campaign Intelligence refresh telemetry failed after commit:", eventError.message);
  }

  revalidatePath(`/studio/campaigns/${campaignId}`);
  revalidatePath(`/studio/campaigns/${campaignId}/intelligence`);
  revalidatePath("/studio/campaigns");
  revalidatePath("/studio/content");
}
