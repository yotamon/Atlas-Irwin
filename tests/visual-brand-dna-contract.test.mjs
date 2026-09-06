import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

async function requireSnippets(path, snippets) {
  const text = await read(path);
  for (const snippet of snippets) {
    assert.ok(text.includes(snippet), `${path} must retain Visual Brand DNA contract: ${snippet}`);
  }
  return text;
}

test("Visual Brand DNA is versioned, artist-scoped and has exactly one active version", async () => {
  const migration = await read("supabase/migrations/20260906234500_visual_brand_dna.sql");
  assert.ok(migration.includes("create table if not exists public.artist_visual_brand_versions"));
  assert.ok(migration.includes("artist_id uuid not null references public.artists"));
  assert.ok(migration.includes("status text not null default 'draft'"));
  assert.ok(migration.includes("unique (artist_id, version)"));
  assert.ok(migration.includes("artist_visual_brand_one_active_idx"));
  assert.ok(migration.includes("where status = 'active'"));
  assert.ok(migration.includes("alter table public.artist_visual_brand_versions enable row level security"));
  assert.ok(migration.includes("private.can_access_artist(artist_id)"));
});

test("all artists share one structured machine-readable Visual Brand DNA schema", async () => {
  await requireSnippets("lib/brand/visual-brand-dna.ts", [
    'version: z.literal("visual-brand-dna-v1")',
    "thesis:",
    "spectrum:",
    "colors:",
    "typography:",
    "motifs:",
    "textures:",
    "materials:",
    "composition:",
    "photography:",
    "humanRepresentation:",
    "antiStyle:",
    "continuityRules:",
    "creativeFreedom:",
    "fieldConfidence:",
    "formatVisualBrandPrompt",
  ]);
});

test("wizard learns from positive, aspirational, experimental and negative visual evidence", async () => {
  await requireSnippets("app/studio/(protected)/settings/brand/visual/page.tsx", [
    "Already me",
    "More like this",
    "Exploring",
    "Not my style",
    "Analyze & build Visual Brand DNA",
    "Canonical references",
    "Activate Visual Brand DNA",
  ]);
  await requireSnippets("lib/brand/visual-brand-analysis.ts", [
    "official = strongest evidence",
    "inspiration = direction the artist wants more of",
    "experimental = possible evolution",
    "avoid = negative reference",
    "Distinguish enduring identity from accidental details",
    "chooseEvidence",
  ]);
});

test("activation turns Visual Brand DNA into the existing central creative-context contract", async () => {
  const actions = await requireSnippets("app/studio/visual-brand-actions.ts", [
    'section: "Visual world"',
    'section: "Visual exclusions"',
    'section: "Visual continuity rules"',
    'section: "Visual prompt templates"',
    "formatVisualBrandPrompt(promptContext)",
    'derived_from: "visual-brand-dna-v1"',
  ]);
  const creativeContext = await requireSnippets("lib/marketing/creative-context.ts", [
    'brand.get("Visual world")',
    'brand.get("Visual exclusions")',
    'brand.get("Visual prompt templates")',
    'brand.get("Visual continuity rules")',
    "context.brand.promptTemplate",
  ]);
  assert.ok(actions.includes("status: \"active\""));
  assert.ok(creativeContext.includes("buildCohesiveVisualPrompt"));
});

test("brand evidence remains media-library-native and artist-local", async () => {
  const evidenceActions = await requireSnippets("app/studio/visual-brand-evidence-actions.ts", [
    "artist:${artist.artistId}",
    "brand:official",
    "brand:inspiration",
    "brand:experimental",
    "brand:avoid",
    'relationship === "avoid"',
    '"brand_negative_reference"',
    '.from("media_assets")',
  ]);
  const media = await read("lib/studio/media.ts");
  const creativeContext = await read("lib/marketing/creative-context.ts");
  assert.ok(media.includes('brand_reference: "Artist visual reference"'));
  assert.ok(media.includes('brand_negative_reference: "Artist negative visual reference"'));
  assert.ok(!media.includes("Atlas Irwin visual reference"));
  assert.ok(evidenceActions.includes('asset_type: nextAssetType'));
  assert.ok(!creativeContext.includes('"brand_negative_reference"'));
});

test("generated reference packs are diverse, approval-gated and never mutate identity automatically", async () => {
  await requireSnippets("lib/brand/visual-brand-reference-pack.ts", [
    "VISUAL_BRAND_REFERENCE_PACK_SIZE = 6",
    'aspectRatio: "1:1"',
    'aspectRatio: "4:5"',
    'aspectRatio: "9:16"',
    'aspectRatio: "16:9"',
    "material_study",
    "motif_study",
    "Use supplied references as visual lineage, not as compositions to copy",
  ]);
  const actions = await requireSnippets("app/studio/visual-brand-reference-actions.ts", [
    "provider.quote(route.request)",
    "approvalRequiredBeforeSpend: true",
    "assertSpecialistMediaSpendAllowed",
    "estimatedUsd: estimatedTotal",
    "provider.submit(request",
    "submission_ambiguous",
    "automaticIdentityMutation: false",
  ]);
  const persistence = await requireSnippets("lib/brand/visual-brand-reference-generation.ts", [
    'asset_type: "brand_reference"',
    '"brand:experimental"',
    '"approval-required"',
    "visual_brand_generation_run_id",
    'stage: "awaiting_review"',
    "automaticIdentityMutation: false",
  ]);
  const page = await requireSnippets("app/studio/(protected)/settings/brand/visual/page.tsx", [
    "Preparing the pack does not spend money",
    "Approve up to $",
    "Review generated references in Evidence",
    "Generated images enter the evidence library as",
  ]);
  assert.ok(actions.indexOf("provider.quote(route.request)") < actions.indexOf("provider.submit(request"));
  assert.ok(persistence.includes('"visual-brand-reference-pack"'));
  assert.ok(page.includes("packEstimate.toFixed(2)"));
});

test("Visual Brand reference generation reuses the shared creative router and callback path", async () => {
  const router = await requireSnippets("lib/marketing/creative-router.ts", [
    "aspectRatio?: CreativeAspectRatio",
    "input.aspectRatio ?? inferredAspectRatio",
    "Ensemblis selected the next",
  ]);
  const webhook = await requireSnippets("app/api/studio/marketing/higgsfield/webhook/route.ts", [
    "applyMarketingCreativeProviderStatus",
    "applyVisualBrandReferenceProviderStatus",
    'if ("ignored" in marketingResult',
  ]);
  assert.ok(!router.includes("so Atlas selected"));
  assert.ok(webhook.includes("runId"));
});
