import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(`${process.cwd()}/${path}`, "utf8");

test("Distribution keeps canonical release identity and exact artist decisions", async () => {
  const [identity, rpc, view, state] = await Promise.all([
    read("supabase/migrations/20260905150000_distribution_last_mile.sql"),
    read("supabase/migrations/20260905150500_distribution_release_identity_rpc.sql"),
    read("app/studio/(protected)/releases/[id]/distribution/release-distribution-artist-view.tsx"),
    read("lib/distribution/artist-facing.ts"),
  ]);
  assert.match(identity, /releases\.label/);
  assert.match(identity, /releases\.upc/);
  assert.match(rpc, /save_distribution_release_identity/);
  assert.match(view, /No readiness score/);
  assert.match(view, /Approve distribution/);
  assert.match(view, /I reviewed this release and approve distribution/);
  assert.match(state, /Confirm the label name/);
  assert.match(state, /Review and confirm release rights/);
  assert.match(state, /Confirm the Spotify artist identity/);
});

test("Distribution snapshots canonical identity and territories before irreversible submission", async () => {
  const [snapshotMigration, router, route] = await Promise.all([
    read("supabase/migrations/20260905151000_distribution_submission_canonical_snapshot.sql"),
    read("app/studio/distribution-edit-router.ts"),
    read("app/studio/(protected)/releases/[id]/distribution/page.tsx"),
  ]);
  assert.match(snapshotMigration, /metadata_snapshot/i);
  assert.match(snapshotMigration, /territor/i);
  assert.match(router, /territory_mode/);
  assert.match(router, /two-letter ISO country code/);
  assert.match(route, /Advanced provider tools/);
});