import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("brand media has first-class reusable visual-reference roles", async () => {
  const media = await source("lib/studio/media.ts");
  const migration = await source("supabase/migrations/20260819164000_marketing_creative_brand_media.sql");
  assert.match(media, /brand_reference/);
  assert.match(media, /brand_motion_reference/);
  assert.match(media, /brand_logo/);
  assert.match(migration, /alter type public\.media_asset_type add value if not exists 'brand_reference'/);
});

test("creative context always prioritizes release artwork and preserves artist lineage", async () => {
  const context = await source("lib/marketing/creative-context.ts");
  assert.match(context, /score: 140/);
  assert.match(context, /Canonical release artwork/);
  assert.match(context, /NON-NEGOTIABLE VISUAL LINEAGE/);
  assert.match(context, /Do not redraw or approximate the artist logo/);
  assert.match(context, /generic AI aesthetic/);
  assert.match(context, /artist:\$\{artistId\}/);
  assert.match(context, /\.eq\("artist_id", artistId\)/);
});

test("a selected Audio Scene is never misrepresented by the canonical master", async () => {
  const context = await source("lib/marketing/creative-context.ts");
  assert.match(context, /selectedAudioScene \? selectedAudioScene\.previewUrl : canonicalAudioUrl/);
  assert.doesNotMatch(context, /selectedAudioScene\?\.previewUrl \|\| canonicalAudioUrl/);
});

test("paid generation is prepared before provider submission", async () => {
  const actions = await source("app/studio/marketing-creative-actions.ts");
  const prepareIndex = actions.indexOf("export async function prepareContentCreativeGeneration");
  const approveIndex = actions.indexOf("export async function approvePreparedCreativeGeneration");
  const submitIndex = actions.indexOf("provider.submit", approveIndex);
  assert.ok(prepareIndex >= 0);
  assert.ok(approveIndex > prepareIndex);
  assert.ok(submitIndex > approveIndex, "provider submission must live behind the explicit approval action");
  assert.doesNotMatch(actions.slice(prepareIndex, approveIndex), /provider\.submit/);
  assert.match(actions, /approvalRequiredBeforeSpend: true/);
  assert.match(actions, /\.eq\("artist_id", artist\.artistId\)/);
});

test("generated assets retain reference provenance and require review", async () => {
  const assets = await source("lib/marketing/generated-assets.ts");
  const generation = await source("lib/marketing/creative-generation.ts");
  assert.match(assets, /reference_asset_ids/);
  assert.match(assets, /release_artwork_url/);
  assert.match(assets, /cohesion_context_score/);
  assert.match(assets, /artist_id/);
  assert.match(assets, /approval_status: "pending"/);
  assert.match(generation, /content\.ai_asset_ready_for_review/);
});

test("Music Lab is artist-neutral and keeps saved draft lineage", async () => {
  const component = await source("components/studio/music-generator.tsx");
  const generator = await source("lib/music/generator.ts");
  const page = await source("app/studio/(protected)/music/page.tsx");

  assert.doesNotMatch(component, /Atlas/);
  assert.doesNotMatch(generator, /Atlas/);
  assert.match(component, /Preserve \{artistName\} DNA/);
  assert.match(component, /artist:\$\{artistId\}/);
  assert.match(component, /ensemblis-music-lab/);
  assert.match(page, /resolveActiveArtistContext/);
  assert.match(page, /\.eq\("artist_id", artist\.artistId\)/);
});

test("creative QC is Ensemblis-configured and preserves active artist lineage", async () => {
  const imageQc = await source("lib/marketing/creative-visual-quality.ts");
  const videoQc = await source("lib/marketing/creative-video-quality.ts");

  for (const qc of [imageQc, videoQc]) {
    assert.match(qc, /ENSEMBLIS_CREATIVE_REVIEW_MODEL/);
    assert.match(qc, /ENSEMBLIS_CREATIVE_REVIEW_FALLBACK_MODELS/);
    assert.match(qc, /ATLAS_CREATIVE_REVIEW_MODEL/);
  }
  assert.doesNotMatch(videoQc, /Atlas Irwin social video|Atlas visual world/);
  assert.match(videoQc, /artist_id: artistId/);
  assert.match(videoQc, /\.eq\("artist_id", artistId\)/);
  assert.match(videoQc, /active artist visual world/);
});

test("environment documentation is Ensemblis-first while preserving explicit legacy compatibility", async () => {
  const env = await source(".env.example");
  assert.match(env, /ENSEMBLIS_AI_GATEWAY_PROVIDER_SORT=cost/);
  assert.match(env, /ENSEMBLIS_MARKETING_MODEL=/);
  assert.match(env, /ENSEMBLIS_CREATIVE_REVIEW_MODEL=/);
  assert.match(env, /legacy fallbacks/);
  assert.doesNotMatch(env, /^ATLAS_SOCIAL_REQUEST_PUBLISH_SCOPES=/m);
  assert.doesNotMatch(env, /^# Atlas /m);
});