import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function requireSnippets(path, snippets) {
  const text = await source(path);
  for (const snippet of snippets) {
    assert.ok(text.includes(snippet), `${path} must retain artist-scope contract: ${snippet}`);
  }
  return text;
}

test("Today resolves one ArtistContext and scopes operational state", async () => {
  const text = await requireSnippets("app/studio/(protected)/page.tsx", [
    "resolveDefaultArtistContext",
    '.eq("artist_id", artist.artistId)',
    'from("next_best_actions")',
    'from("publication_jobs")',
    'from("outreach_messages")',
  ]);
  assert.ok((text.match(/\.eq\("artist_id", artist\.artistId\)/g) ?? []).length >= 8,
    "Today should keep artist filters across every artist-scoped decision-surface query");
});

test("Campaign mutations resolve a validated artist before writes", async () => {
  const text = await requireSnippets("app/studio/marketing-actions.ts", [
    "resolveArtistContext",
    "resolveDefaultArtistContext",
    "async function actionContext",
    "artist_id: artist.artistId",
    '.eq("artist_id", artist.artistId)',
  ]);
  assert.doesNotMatch(text, /legacy_artist_for_owner/,
    "Campaign actions must not infer the active artist from owner compatibility helpers");
});

test("Production and paid creative require explicit artist lineage", async () => {
  await requireSnippets("app/studio/(protected)/production/page.tsx", [
    "resolveDefaultArtistContext",
    '.eq("artist_id", artist.artistId)',
    'name="artist_id" value={artist.artistId}',
  ]);
  await requireSnippets("app/studio/marketing-creative-actions.ts", [
    "resolveArtistContext",
    "resolveDefaultArtistContext",
    "async function actionContext",
    "artistId: artist.artistId",
    '.eq("artist_id", artist.artistId)',
    "assertSpecialistMediaSpendAllowed",
  ]);
  await requireSnippets("lib/marketing/creative-generation.ts", [
    "run.artist_id",
    "creativeContext.artistId !== artistId",
    '.eq("artist_id", artistId)',
    "settleCampaignSpendForGeneration",
  ]);
});

test("Creative context and reviewed creative memory cannot cross artists", async () => {
  await requireSnippets("lib/marketing/creative-context.ts", [
    "artistId: string",
    '.eq("artist_id", artistId)',
    "artist:${artistId}",
  ]);
  await requireSnippets("lib/marketing/creative-dna.ts", [
    "artistId: string",
    '.eq("artist_id", input.artistId)',
  ]);
});

test("Audience and social OAuth carry owner plus artist", async () => {
  await requireSnippets("lib/marketing/audience.ts", [
    "artistId",
    '.eq("artist_id", artistId)',
  ]);
  await requireSnippets("lib/marketing/social-auth.ts", [
    "artistId",
    "get_social_channel_token_for_artist",
  ]);
  await requireSnippets("app/studio/(protected)/settings/social/[platform]/callback/route.ts", [
    "artistIdFromState",
    "resolveArtistContext",
    "completeSocialOAuth",
    "artistId: artist.artistId",
  ]);
});

test("manual and background external-effect execution preserve artist scope", async () => {
  await requireSnippets("app/studio/marketing-runtime-actions.ts", [
    "resolveArtistContext",
    "resolveDefaultArtistContext",
    "async function runtimeContext",
    '.eq("artist_id", artist.artistId)',
    "artistId: artist.artistId",
  ]);
  await requireSnippets("lib/marketing/automation.ts", [
    "artistId",
    "claim_marketing_automation_jobs_for_artist",
  ]);
  await requireSnippets("lib/marketing/publications.ts", [
    "artistId",
    '.eq("artist_id", scope.artistId)',
  ]);
  await requireSnippets("lib/marketing/outreach.ts", [
    "artistId",
    '.eq("artist_id", scope.artistId)',
  ]);
});

test("campaign AI spend controls and service accounting are artist-local", async () => {
  await requireSnippets("app/studio/campaign-ai-spend-actions.ts", [
    "resolveArtistContext",
    '.eq("artist_id", artist.artistId)',
    "artist_id: artist.artistId",
  ]);
  await requireSnippets("lib/marketing/campaign-ai-spend.ts", [
    "artistId",
    "reserve_campaign_ai_spend_for_artist",
    "settle_campaign_ai_spend_for_artist",
    "release_campaign_ai_spend_for_artist",
  ]);
});

test("Brand memory is artist-local while shared media requires an artist tag", async () => {
  await requireSnippets("app/studio/brand-actions-v2.ts", [
    "requireArtistContext",
    '.eq("artist_id", artist.artistId)',
    "artist_id: artist.artistId",
  ]);
  await requireSnippets("app/studio/(protected)/brand/page.tsx", [
    '.eq("artist_id", artist.artistId)',
    "artistTag",
  ]);
});
