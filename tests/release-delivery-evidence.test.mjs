import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function loadDeliverySignal() {
  const input = await source("lib/studio/release-delivery-signal.ts");
  const compiled = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", compiled)(module, module.exports);
  return module.exports.deriveDeliverySignal;
}

test("a live website or legacy release never invents DSP confirmation", async () => {
  const derive = await loadDeliverySignal();
  const result = derive({
    releaseIsLive: true,
    providerState: null,
    accountStatus: null,
  });
  assert.equal(result.kind, "external_untracked");
  assert.equal(result.providerConfirmed, false);
  assert.equal(result.requiresAttention, false);
  assert.match(result.detail, /no provider submission evidence/);
});

test("no provider account and no package require visible launch work", async () => {
  const derive = await loadDeliverySignal();
  const absent = derive({ releaseIsLive: false, providerState: null, accountStatus: null });
  assert.equal(absent.kind, "needs_setup");
  assert.equal(absent.requiresAttention, true);
  const draft = derive({ releaseIsLive: false, providerState: "draft", accountStatus: "active" });
  assert.equal(draft.kind, "needs_preflight");
  assert.equal(draft.providerConfirmed, false);
});

test("approval readiness is not a submission or a live release", async () => {
  const derive = await loadDeliverySignal();
  const ready = derive({ releaseIsLive: false, providerState: "ready", accountStatus: "active" });
  assert.equal(ready.kind, "ready_for_approval");
  assert.equal(ready.requiresAttention, true);
  assert.equal(ready.providerConfirmed, false);
  const sent = derive({ releaseIsLive: false, providerState: "under_review", accountStatus: "active" });
  assert.equal(sent.kind, "in_flight");
  assert.equal(sent.providerConfirmed, true);
  assert.equal(sent.label, "Submitted to distributor");
  const live = derive({ releaseIsLive: false, providerState: "live", accountStatus: "active" });
  assert.equal(live.kind, "confirmed_live");
  assert.equal(live.providerConfirmed, true);
});

test("unavailable or unexpected provider evidence fails closed", async () => {
  const derive = await loadDeliverySignal();
  const error = derive({ releaseIsLive: true, providerState: "live", accountStatus: "active", evidenceUnavailable: true });
  assert.equal(error.kind, "unavailable");
  assert.equal(error.providerConfirmed, false);
  const unknown = derive({ releaseIsLive: false, providerState: "mystery", accountStatus: "active" });
  assert.equal(unknown.kind, "unavailable");
  assert.equal(unknown.requiresAttention, true);
  const failed = derive({ releaseIsLive: false, providerState: "rejected", accountStatus: "active" });
  assert.equal(failed.kind, "needs_review");
});

test("delivery readback preserves owner/artist scopes and never writes or submits", async () => {
  const loader = await source("lib/studio/release-delivery-signal-server.ts");
  assert.match(loader, /\.from\("distribution_accounts"\)/);
  assert.match(loader, /\.from\("release_distribution_configs"\)/);
  assert.match(loader, /\.eq\("owner_id", input\.ownerId\)/);
  assert.match(loader, /\.eq\("artist_id", input\.artistId\)/);
  assert.match(loader, /\.eq\("release_id", input\.releaseId\)/);
  assert.doesNotMatch(loader, /\.insert\(|\.update\(|\.upsert\(|\.rpc\(|submitRelease\(/);
});

test("Release and Today show the same delivery evidence, without treating visits as streams", async () => {
  const [mission, release, snapshot, today, page] = await Promise.all([
    source("lib/studio/release-mission.ts"),
    source("components/studio/release-workspace-v2.tsx"),
    source("lib/studio/release-workspace.ts"),
    source("lib/studio/artist-operating-snapshot.ts"),
    source("app/studio/(protected)/releases/[id]/page.tsx"),
  ]);
  assert.match(mission, /input\.deliverySignal\?\.requiresAttention/);
  assert.match(release, /deliverySignal=|deliverySignal,/);
  assert.match(release, /Recorded first-party landings and actions, not confirmed streams/);
  assert.match(snapshot, /loadReleaseDeliverySignal/);
  assert.match(snapshot, /asSmartLinksClient\(input\.db\)\.from\("smart_link_events"\)/);
  assert.match(today, /deliverySignal: activeDeliverySignal/);
  assert.match(page, /deliverySignal=\{snapshot\.deliverySignal\}/);
});
