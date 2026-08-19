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

test("creative context always prioritizes release artwork and preserves lineage", async () => {
  const context = await source("lib/marketing/creative-context.ts");
  assert.match(context, /score: 140/);
  assert.match(context, /Canonical release artwork/);
  assert.match(context, /NON-NEGOTIABLE VISUAL LINEAGE/);
  assert.match(context, /Do not redraw or approximate the Atlas Irwin logo/);
  assert.match(context, /generic cyberpunk/);
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
});

test("generated assets retain reference provenance and require review", async () => {
  const assets = await source("lib/marketing/generated-assets.ts");
  const generation = await source("lib/marketing/creative-generation.ts");
  assert.match(assets, /reference_asset_ids/);
  assert.match(assets, /release_artwork_url/);
  assert.match(assets, /cohesion_context_score/);
  assert.match(assets, /approval_status: "pending"/);
  assert.match(generation, /content\.ai_asset_ready_for_review/);
});
