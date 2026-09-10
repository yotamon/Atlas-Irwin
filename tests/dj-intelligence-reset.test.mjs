import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("Personal DJ Intelligence reset removes every learning source but no music data", async () => {
  const route = await source("app/api/studio/automix/preferences/route.ts");
  const migration = await source("supabase/migrations/20260910002000_dj_intelligence_reset.sql");
  const panel = await source("components/studio/dj-intelligence-panel.tsx");

  assert.ok(route.includes('export async function DELETE'));
  assert.ok(route.includes('from("dj_library_history_evidence")'));
  assert.ok(route.includes('from("dj_preference_evidence")'));
  assert.ok(route.includes('from("dj_profiles")'));
  assert.equal(route.includes('from("tracks")'), false);
  assert.equal(route.includes('from("automix_jobs")'), false);
  assert.equal(route.includes('from("releases")'), false);

  for (const table of ["dj_profiles", "dj_preference_evidence", "dj_library_history_evidence"]) {
    assert.ok(migration.includes(`${table}_delete_own`), `${table} reset policy is missing`);
    assert.ok(migration.includes(`grant delete on public.${table} to authenticated`));
  }
  assert.ok(migration.includes("auth.uid() = owner_id"));
  assert.ok(migration.includes("private.can_access_artist(artist_id)"));

  assert.ok(panel.includes("Reset learning"));
  assert.ok(panel.includes('method: "DELETE"'));
  assert.ok(panel.includes("Your tracks, mixes and source libraries are not changed"));
});
