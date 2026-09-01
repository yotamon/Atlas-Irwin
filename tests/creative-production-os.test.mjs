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
