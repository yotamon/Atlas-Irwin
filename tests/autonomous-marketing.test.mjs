import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const files = [
  "lib/marketing/social-auth.ts",
  "lib/marketing/social-oauth.ts",
  "lib/marketing/audience.ts",
  "lib/marketing/radar.ts",
  "lib/marketing/next-best-action.ts",
  "lib/marketing/cron-auth.ts",
  "lib/marketing/free-content-factory.ts",
  "lib/marketing/channels/instagram.ts",
  "lib/marketing/channels/tiktok.ts",
  "lib/marketing/channels/youtube.ts",
  "app/api/cron/content-factory/route.ts",
  "app/studio/(protected)/audience/page.tsx",
  "app/studio/(protected)/autopilot/page.tsx",
  "supabase/migrations/20260821214500_autonomous_marketing_os.sql",
  "supabase/cron/marketing-automation.sql",
];

test("autonomous marketing surfaces and durable state exist", async () => {
  await Promise.all(files.map((path) => access(path)));
  const migration = await readFile("supabase/migrations/20260821214500_autonomous_marketing_os.sql", "utf8");
  for (const table of ["audience_interactions", "marketing_opportunities", "next_best_actions", "automation_runtime_secrets"]) {
    assert.ok(migration.includes(`create table public.${table}`));
    assert.ok(migration.includes(`alter table public.${table} enable row level security`));
  }
  assert.ok(migration.includes("revoke all on public.automation_runtime_secrets from anon, authenticated"));
});

test("first-party channel adapters replace the fake universal manual adapter", async () => {
  const router = await readFile("lib/marketing/channels.ts", "utf8");
  const instagram = await readFile("lib/marketing/channels/instagram.ts", "utf8");
  const tiktok = await readFile("lib/marketing/channels/tiktok.ts", "utf8");
  const youtube = await readFile("lib/marketing/channels/youtube.ts", "utf8");

  assert.ok(instagram.includes("class InstagramChannelAdapter"));
  assert.ok(tiktok.includes("class TikTokChannelAdapter"));
  assert.ok(youtube.includes("class YouTubeChannelAdapter"));
  assert.ok(tiktok.includes("TIKTOK_DIRECT_POST_AUDITED"));
  assert.ok(tiktok.includes("tiktok:draft-upload"));
  assert.ok(instagram.includes("instagram_business_manage_insights"));
  assert.ok(youtube.includes("youtube.upload"));
  assert.ok(tiktok.includes("Math.floor(size / chunkSize)"));
  assert.ok(tiktok.includes("isFinalChunk ? size : start + chunkSize"));
  assert.ok(router.includes('if (key === "instagram") return new InstagramChannelAdapter();'));
  assert.ok(router.includes('if (key === "tiktok") return new TikTokChannelAdapter();'));
  assert.ok(router.includes('if (key === "youtube") return new YouTubeChannelAdapter();'));
  assert.ok(router.includes("return new ManualHandoffAdapter(platform);"));
});

test("social OAuth asks only for automation capabilities Atlas can actually use", async () => {
  const oauth = await readFile("lib/marketing/social-oauth.ts", "utf8");
  for (const scope of [
    "instagram_business_content_publish",
    "instagram_business_manage_insights",
    "instagram_business_manage_comments",
    "video.list",
    "video.upload",
    "youtube.upload",
    "youtube.force-ssl",
  ]) assert.ok(oauth.includes(scope));
  assert.ok(oauth.includes('truthyEnv("TIKTOK_DIRECT_POST_AUDITED")'));
});

test("published content feeds the measurement and learning loop", async () => {
  const publications = await readFile("lib/marketing/publications.ts", "utf8");
  const automation = await readFile("lib/marketing/automation.ts", "utf8");
  assert.ok(publications.includes('event_type: "content.published"'));
  assert.ok(automation.includes('event.event_type === "content.published"'));
  assert.ok(automation.includes("for (const hours of [24, 72, 168])"));
  assert.ok(automation.includes("evaluate_experiment"));
  assert.ok(automation.includes("generate_winner_derivatives"));
});

test("the lightweight automation cycle senses before ranking next actions", async () => {
  const cron = await readFile("app/api/cron/marketing/route.ts", "utf8");
  const publication = cron.indexOf("processDuePublicationJobs()");
  const audience = cron.indexOf("syncAudienceInteractions()");
  const radar = cron.indexOf("refreshMarketingRadarIfDue()");
  const decision = cron.indexOf("refreshNextBestActions()");
  assert.ok(publication > 0 && audience > publication && radar > audience && decision > radar);
  assert.equal(cron.includes("fillOneMissingScheduledAsset"), false);
  assert.ok(cron.includes("export const maxDuration = 55"));

  const audienceCode = await readFile("lib/marketing/audience.ts", "utf8");
  assert.ok(audienceCode.includes("Replies are never auto-sent") === false);
  assert.ok(audienceCode.includes("sendAudienceReply"));
  assert.ok(audienceCode.includes("MAX_REPLY_DRAFTS_PER_CYCLE"));
});

test("Hobby-safe scheduler self-provisions a Vault secret and separates heavy work", async () => {
  const route = await readFile("app/api/cron/marketing/route.ts", "utf8");
  const factoryRoute = await readFile("app/api/cron/content-factory/route.ts", "utf8");
  const auth = await readFile("lib/marketing/cron-auth.ts", "utf8");
  const provisioning = await readFile("supabase/cron/marketing-automation.sql", "utf8");
  const factory = await readFile("lib/marketing/free-content-factory.ts", "utf8");

  assert.ok(route.includes("authorizeMarketingCron(request)"));
  assert.ok(factoryRoute.includes("authorizeMarketingCron(request)"));
  assert.ok(factoryRoute.includes("fillOneMissingScheduledAsset()"));
  assert.ok(factoryRoute.includes("export const maxDuration = 55"));
  assert.ok(auth.includes('from("automation_runtime_secrets")'));
  assert.ok(auth.includes('process.env.CRON_SECRET'));
  assert.ok(provisioning.includes("vault.create_secret"));
  assert.ok(provisioning.includes("vault.update_secret"));
  assert.ok(provisioning.includes("extensions.digest(v_secret, 'sha256')"));
  assert.ok(provisioning.includes("'*/15 * * * *'"));
  assert.ok(provisioning.includes("'17 */6 * * *'"));
  assert.ok(provisioning.includes("timeout_milliseconds := 50000"));
  assert.ok(provisioning.includes("atlas-marketing-every-5-min"));
  assert.equal(provisioning.includes("'*/5 * * * *'"), false);
  assert.equal(provisioning.includes("the same value as Vercel CRON_SECRET"), false);

  assert.ok(factory.includes("const DAILY_RENDER_LIMIT = 2"));
  assert.ok(factory.includes("const MONTHLY_RENDER_LIMIT = 40"));
  assert.ok(factory.includes("const COMPOSITION_HORIZON_HOURS = 36"));
  assert.ok(factory.includes('provider: "atlas-free-composer"'));
  assert.ok(factory.includes('outcome: "free_quota_exhausted"'));
  assert.ok(factory.includes("Atlas will not use a paid fallback"));
});
