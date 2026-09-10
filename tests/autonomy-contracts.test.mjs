import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("autonomy has explicit Assist Prepare Run modes and conservative defaults", async () => {
  const domain = await source("lib/autonomy/domain.ts");
  for (const snippet of [
    'export type AutonomyMode = "assist" | "prepare" | "run"',
    'distribution: {',
    'defaultMode: "assist"',
    'paid_growth: {',
    'creative_generation: {',
    'defaultMode: "prepare"',
    'music_analysis: {',
    'defaultMode: "run"',
  ]) assert.ok(domain.includes(snippet), `autonomy domain contract is missing ${snippet}`);
});

test("hard safety boundaries cannot be overridden by Run", async () => {
  const domain = await source("lib/autonomy/domain.ts");
  for (const snippet of [
    "input.effect.sensitiveCommunication",
    "input.effect.legalDeclaration",
    "input.effect.destructive || input.effect.irreversible",
    'input.effect.distributionSubmission || input.domain === "distribution"',
    'behavior: "ask"',
    "Distribution submission always requires explicit artist confirmation in autonomy v1.",
  ]) assert.ok(domain.includes(snippet), `hard autonomy boundary is missing ${snippet}`);
});

test("paid Run requires explicit ceilings and never replaces existing spend gates", async () => {
  const domain = await source("lib/autonomy/domain.ts");
  const migration = await source("supabase/migrations/20260905023000_artist_autonomy_contracts.sql");
  const campaignSpend = await source("supabase/migrations/20260903152000_artist_scoped_campaign_ai_spend_atomic.sql");
  assert.ok(domain.includes('contract?.maxSingleSpendUsd == null'));
  assert.ok(domain.includes("estimatedCost > contract.maxSingleSpendUsd"));
  assert.ok(domain.includes("currentSpend + estimatedCost > contract.maxTotalSpendUsd"));
  assert.ok(migration.includes("never bypasses spend, provider, publication, distribution or sensitive-action safeguards"));
  assert.ok(campaignSpend.includes("Generation reservation would exceed campaign AI hard limit."));
  assert.ok(campaignSpend.includes("max_single_generation_usd"));
});

test("expired or disabled contracts cannot grant authority", async () => {
  const domain = await source("lib/autonomy/domain.ts");
  assert.ok(domain.includes("if (!contract?.enabled) return null"));
  assert.ok(domain.includes("expiry > now.getTime() ? contract : null"));
  assert.ok(domain.includes("const mode = contract?.mode ?? AUTONOMY_DOMAIN_META[input.domain].defaultMode"));
});

test("external effects require an explicit Run contract before automatic execution", async () => {
  const domain = await source("lib/autonomy/domain.ts");
  assert.ok(domain.includes('if (!contract && (input.effect.external || input.effect.paid))'));
  assert.ok(domain.includes("External effects do not inherit implicit Run authority."));
  assert.ok(domain.includes("Existing provider, spend and approval gates still apply."));
});

test("autonomy persistence is artist scoped and decision audit is append-only for authenticated users", async () => {
  const migration = await source("supabase/migrations/20260905023000_artist_autonomy_contracts.sql");
  for (const snippet of [
    "private.can_access_artist(artist_id)",
    "owner_id = auth.uid()",
    "unique (owner_id, artist_id, domain)",
    "grant select on table public.autonomy_decision_events to authenticated",
    "grant select, insert on table public.autonomy_decision_events to service_role",
  ]) assert.ok(migration.includes(snippet), `autonomy persistence is missing ${snippet}`);
  assert.equal(migration.includes("grant insert on table public.autonomy_decision_events to authenticated"), false);
  assert.equal(migration.includes("grant update on table public.autonomy_decision_events to authenticated"), false);
  assert.equal(migration.includes("grant delete on table public.autonomy_decision_events to authenticated"), false);
});

test("artist can configure autonomy without exposing provider plumbing by default", async () => {
  const page = await source("app/studio/(protected)/settings/autonomy/page.tsx");
  const settings = await source("app/studio/(protected)/settings/page.tsx");
  for (const snippet of [
    'title="Autonomy"',
    "Assist, Prepare, or Run",
    "Some decisions always come back to you",
    "Save autonomy contract",
    "Advanced restrictions",
    "Allowed platforms",
    "Allowed providers",
  ]) assert.ok(page.includes(snippet), `autonomy settings are missing ${snippet}`);
  assert.ok(settings.includes('href="/studio/settings/autonomy"'));
  assert.ok(settings.includes("Set autonomy rules"));
});

test("server mutations resolve the active artist instead of trusting a client artist id", async () => {
  const actions = await source("app/studio/autonomy-contract-actions.ts");
  assert.ok(actions.includes("requireStudioAdmin()"));
  assert.ok(actions.includes("resolveActiveArtistContext(supabase, user)"));
  assert.ok(actions.includes("artistId: artist.artistId"));
  assert.equal(actions.includes('formData.get("artist_id")'), false);
});

test("autonomy decision auditing snapshots both governing contract and requested effect", async () => {
  const server = await source("lib/autonomy/server.ts");
  assert.ok(server.includes("resolveAndAuditAutonomyDecision"));
  assert.ok(server.includes('from("autonomy_decision_events").insert'));
  assert.ok(server.includes("contract_snapshot"));
  assert.ok(server.includes("effect_snapshot"));
  assert.ok(server.includes("resolved_behavior: decision.behavior"));
});

test("legacy risk policy remains approval gated for paid and external effects", async () => {
  const policy = await source("features/studio-v2/policy.mjs");
  assert.ok(policy.includes("if (paid || external) return \"approval\""));
  assert.ok(policy.includes("if (destructive) return \"confirmation\""));
});
