import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Creative Director builds music-aware treatments instead of direct provider prompts", async () => {
  const treatment = await source("lib/marketing/creative-treatment.ts");
  assert.match(treatment, /creative-director-v1/);
  assert.match(treatment, /conciseLyricsPromptContext/);
  assert.match(treatment, /selectedAudioScene/);
  assert.match(treatment, /shotPlan/);
  assert.match(treatment, /sourcePreference/);
  assert.match(treatment, /generic cyberpunk/);
  assert.match(treatment, /deterministic post-production/);
  assert.match(treatment, /do not reconstruct them/i);
});

test("paid creative generation is blocked by a production preflight gate", async () => {
  const quality = await source("lib/marketing/creative-quality.ts");
  const actions = await source("app/studio/marketing-creative-actions.ts");
  assert.match(quality, /creative-production-gate-v1/);
  assert.match(quality, /visual-lineage/);
  assert.match(quality, /platform-geometry/);
  assert.match(quality, /anti-slop/);
  assert.match(quality, /deterministic-finishing/);
  assert.match(quality, /humanVisualReviewRequired: true/);
  assert.match(actions, /directContentCreative/);
  assert.match(actions, /assessCreativeProductionPreflight/);
  assert.match(actions, /assertCreativeProductionGate\(productionGate\)/);
  const gateIndex = actions.indexOf("assertCreativeProductionGate(productionGate)");
  const quoteIndex = actions.indexOf("provider.quote", gateIndex);
  assert.ok(gateIndex >= 0 && quoteIndex > gateIndex, "production gate must pass before paid provider quoting/submission lineage is prepared");
});

test("human visual decisions become generation learning outcomes", async () => {
  const actions = await source("app/studio/marketing-creative-actions.ts");
  assert.match(actions, /user_outcome: "accepted"/);
  assert.match(actions, /user_outcome: "rejected"/);
  assert.match(actions, /humanVisualApprovedAt/);
  assert.match(actions, /humanVisualRejectedAt/);
  assert.match(actions, /productionGateScore/);
});

test("social platform packages are native instead of generic square-or-vertical presets", async () => {
  const packages = await source("lib/marketing/platform-packages.ts");
  const router = await source("lib/marketing/creative-router.ts");
  assert.match(packages, /instagram-story/);
  assert.match(packages, /instagram-feed-portrait/);
  assert.match(packages, /instagram-carousel/);
  assert.match(packages, /tiktok-photo/);
  assert.match(packages, /youtube-short/);
  assert.match(packages, /aspectRatio: "4:5"/);
  assert.match(packages, /maxAssets: 35/);
  assert.match(router, /return "4:5"/);
  assert.match(router, /provider === "bfl"/);
  assert.match(router, /routeCompatible/);
});

test("TikTok photo posts use first-party Content Posting API with AIGC metadata", async () => {
  const tiktok = await source("lib/marketing/channels/tiktok.ts");
  assert.match(tiktok, /post\/publish\/content\/init/);
  assert.match(tiktok, /media_type: "PHOTO"/);
  assert.match(tiktok, /photo_images: photos/);
  assert.match(tiktok, /photo_cover_index/);
  assert.match(tiktok, /is_aigc/);
  assert.match(tiktok, /DIRECT_POST/);
  assert.match(tiktok, /MEDIA_UPLOAD/);
});

test("YouTube receives private future uploads and Atlas reconciles provider-owned schedules", async () => {
  const youtube = await source("lib/marketing/channels/youtube.ts");
  const publications = await source("lib/marketing/publications.ts");
  const migration = await source("supabase/migrations/20260901172000_provider_scheduled_publications.sql");
  const types = await source("types/marketing-database.ts");
  assert.match(youtube, /providerScheduling: configured/);
  assert.match(youtube, /privacyStatus: scheduledAt \? "private"/);
  assert.match(youtube, /publishAt: scheduledAt/);
  assert.match(youtube, /status: scheduledAt \? "provider_scheduled"/);
  assert.match(youtube, /fetchPublicationStatus/);
  assert.match(publications, /PROVIDER_SCHEDULE_LEAD_MS/);
  assert.match(publications, /reconcileProviderScheduledPublications/);
  assert.match(publications, /publication\.provider_scheduled/);
  assert.match(migration, /provider_scheduled/);
  assert.match(types, /"provider_scheduled" \| "manual_ready"/);
});

test("AI video cannot reach approval before deterministic finishing and temporal QC", async () => {
  const generation = await source("lib/marketing/creative-generation.ts");
  const production = await source("lib/marketing/media-production.ts");
  const finishing = await source("services/media-worker/app/social_finishing.py");
  const callback = await source("app/api/studio/marketing/media-worker/callback/route.ts");
  const guard = await source("supabase/migrations/20260901175500_ai_creative_approval_guard.sql");

  assert.match(generation, /enqueueMarketingVideoFinishing/);
  assert.match(generation, /stage = "finishing_queued"/);
  assert.match(generation, /Raw provider video is blocked from approval/);
  assert.match(production, /reviewFrameTimestamps/);
  assert.match(production, /audio_scene/);
  assert.match(production, /canonical_master/);
  assert.match(finishing, /libx264/);
  assert.match(finishing, /"-c:a", "aac"/);
  assert.match(finishing, /alimiter=limit=0\.98/);
  assert.match(finishing, /Social video finishing requires at least three temporal QC frames/);
  assert.match(callback, /reviewGeneratedCreativeVideo/);
  assert.match(callback, /qualityPassed \? "creative_review"/);
  assert.match(callback, /"creative_qc_pending"/);
  assert.match(guard, /AI creative cannot be approved before deterministic finishing and automated quality control pass/);
  assert.match(guard, /\{visualQuality,passed\}/);
});

test("approved masters expand only through native zero-generation-spend derivatives", async () => {
  const derivatives = await source("lib/marketing/creative-derivatives.ts");
  const events = await source("lib/marketing/creative-derivative-events.ts");
  const migration = await source("supabase/migrations/20260901180500_creative_derivatives.sql");

  assert.match(derivatives, /status", "connected"/);
  assert.match(derivatives, /allowed\.add\("instagram-reel"\)/);
  assert.match(derivatives, /allowed\.add\("instagram-story"\)/);
  assert.match(derivatives, /allowed\.add\(kind === "video" \? "tiktok-video" : "tiktok-photo"\)/);
  assert.match(derivatives, /allowed\.add\("youtube-short"\)/);
  assert.match(derivatives, /allowed\.delete\(sourcePackageId\)/);
  assert.match(derivatives, /estimated_cost_usd: 0/);
  assert.match(derivatives, /actual_cost_usd: 0/);
  assert.match(derivatives, /zeroGenerationSpend: true/);
  assert.match(derivatives, /enqueueMarketingVideoFinishing/);
  assert.match(derivatives, /reuse_approved_image/);
  assert.match(derivatives, /deterministic_video_repackage/);
  assert.match(events, /content\.ai_asset_approved/);
  assert.match(migration, /unique\(owner_id, master_content_item_id, target_package_id\)/);
});

test("campaign Autopilot spend is atomically reserved and ambiguity never auto-retries", async () => {
  const migration = await source("supabase/migrations/20260901183000_campaign_ai_spend_envelopes.sql");
  const processor = await source("lib/marketing/autonomous-creative-spend.ts");
  const card = await source("components/studio/campaign-ai-spend-card.tsx");

  assert.match(migration, /c\.mode = 'autopilot'/);
  assert.match(migration, /for update of e/);
  assert.match(migration, /max_single_generation_usd/);
  assert.match(migration, /envelope_row\.reserved_usd \+ envelope_row\.spent_usd \+ p_amount_usd > envelope_row\.hard_limit_usd/);
  assert.match(migration, /overrun_usd/);
  assert.match(processor, /reserveCampaignAiSpend/);
  assert.match(processor, /assertSpecialistMediaSpendAllowed/);
  assert.match(processor, /stage: "submission_ambiguous"/);
  assert.match(processor, /will not retry automatically/);
  assert.match(processor, /reserveLocked: true/);
  assert.match(card, /AI Creative Budget/);
  assert.match(card, /Campaign mode alone never authorizes spend/);
  assert.match(card, /Pause autonomous creative spend/);
});
