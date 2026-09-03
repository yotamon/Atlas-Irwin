import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Distribution data carries durable artist lineage while provider accounts stay workspace-level", async () => {
  const migration = await source("supabase/migrations/20260903234500_distribution_artist_scope.sql");
  const accountEvents = await source("supabase/migrations/20260903235000_distribution_shared_account_events.sql");

  for (const table of [
    "distribution_artist_profiles",
    "release_distribution_configs",
    "distribution_submissions",
    "distribution_deliveries",
    "distribution_validation_issues",
    "distribution_track_metadata",
    "distribution_track_writers",
    "distribution_track_contributors",
    "distribution_provider_operations",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} add column if not exists artist_id`));
  }
  assert.doesNotMatch(migration, /alter table public\.distribution_accounts add column if not exists artist_id/);
  assert.match(migration, /private\.assert_operational_artist_owner/);
  assert.match(migration, /release_distribution_configs_validate_artist_scope/);
  assert.match(migration, /distribution_provider_operations_validate_artist_scope/);
  assert.match(accountEvents, /alter table public\.distribution_events alter column artist_id drop not null/);
  assert.match(accountEvents, /account-only event is intentionally workspace-level/);
});

test("Distribution portfolio and release surfaces are scoped to one ArtistContext", async () => {
  const hub = await source("app/studio/(protected)/distribution/page.tsx");
  const operations = await source("app/studio/(protected)/distribution/operations/page.tsx");
  const release = await source("app/studio/(protected)/releases/[id]/distribution/release-distribution-page.tsx");
  const lifecycle = await source("app/studio/(protected)/releases/[id]/distribution/release-distribution-lifecycle.tsx");

  for (const file of [hub, operations, release, lifecycle]) {
    assert.match(file, /resolveDefaultArtistContext/);
    assert.match(file, /\.eq\("artist_id", artist\.artistId\)/);
  }
  assert.match(release, /name="artist_id" value=\{artist\.artistId\}/);
  assert.match(lifecycle, /name="artist_id" value=\{artist\.artistId\}/);
});

test("Distribution mutations reject sibling releases before provider or core execution", async () => {
  const safeActions = await source("app/studio/distribution-actions-safe.ts");
  const edits = await source("app/studio/distribution-edit-router.ts");

  assert.match(safeActions, /resolveArtistContext/);
  assert.match(safeActions, /validateReleaseArtistScope/);
  assert.match(safeActions, /\.eq\("artist_id", artist\.artistId\)/);
  assert.match(safeActions, /form\.set\("artist_id", artist\.artistId\)/);
  assert.match(safeActions, /await validateReleaseArtistScope\(form\);\s*await action\(form\);/);

  assert.match(edits, /resolveArtistContext/);
  assert.match(edits, /\.eq\("artist_id", artist\.artistId\)/);
  assert.match(edits, /artist_id: context\.artist\.artistId/);
  assert.match(edits, /onConflict: "artist_id,platform"/);
});
