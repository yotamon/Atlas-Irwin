import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(`${process.cwd()}/${path}`, "utf8");

test("Paid Growth has hard spend, immutable approval and verified evidence boundaries", async () => {
  const [foundation, hardening, currency, lock, serviceObservations] = await Promise.all([
    read("supabase/migrations/20260905170000_paid_growth_experiments.sql"),
    read("supabase/migrations/20260905170500_paid_growth_hardening.sql"),
    read("supabase/migrations/20260905171000_paid_growth_currency.sql"),
    read("supabase/migrations/20260905171500_paid_growth_contract_lock.sql"),
    read("supabase/migrations/20260905172000_paid_growth_service_observations.sql"),
  ]);
  const combined = [foundation, hardening, currency, lock, serviceObservations].join("\n");
  assert.match(combined, /budget_ceiling_cents/);
  assert.match(combined, /Paid growth hard budget ceiling exceeded/);
  assert.match(combined, /paid_growth_observations_immutable/);
  assert.match(combined, /approval_status/);
  assert.match(combined, /USD/);
  assert.match(combined, /record_paid_growth_observation/);
  assert.match(combined, /verification_reference/);
  assert.match(lock, /approved/i);
  assert.match(lock, /hypothesis/);
  assert.match(lock, /budget_ceiling_cents/);
});

test("Paid Growth fails closed without a real provider and only verified outcomes learn", async () => {
  const [provider, actions, domain] = await Promise.all([
    read("lib/paid-growth/provider.ts"),
    read("app/studio/paid-growth-actions.ts"),
    read("lib/paid-growth/domain.ts"),
  ]);
  assert.match(provider, /configured = false/);
  assert.match(provider, /will not pretend an external campaign was launched/);
  assert.match(provider, /throw new Error\(this\.reasonUnavailable\)/);
  assert.match(actions, /loadArtistAutonomyContract/);
  assert.match(actions, /estimatedCostUsd/);
  assert.match(actions, /verified_outcome/);
  assert.match(domain, /learningEligible: verified/);
  assert.match(domain, /stopOnSuccess|Success threshold reached/);
});