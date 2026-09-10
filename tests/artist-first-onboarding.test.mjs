import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFile(`${root}/${path}`, "utf8");

test("artist onboarding is derived from real music and mission state", async () => {
  const [page, actions, migration, intake] = await Promise.all([
    read("app/studio/onboarding/page.tsx"),
    read("app/studio/onboarding/actions.ts"),
    read("supabase/migrations/20260905173000_artist_activation.sql"),
    read("app/studio/(protected)/music/import/page.tsx"),
  ]);

  assert.match(page, /Start with the music, not the setup/);
  assert.match(page, /Add one mastered track/);
  assert.match(page, /Track Intelligence/);
  assert.match(page, /Start Release Mission/);
  assert.match(page, /Review .*curated Moment/);
  assert.match(page, /Create from a Moment/);
  assert.match(page, /promoteVaultTrack/);
  assert.doesNotMatch(page, /API key|provider setup|connect provider|brand questionnaire/i);

  assert.match(actions, /confirm_ensemblis_artist_identity/);
  assert.match(actions, /resolveActiveArtistContext/);
  assert.match(migration, /unique \(artist_id, event_type\)/);
  assert.match(migration, /first_music_added/);
  assert.match(migration, /first_intelligence_ready/);
  assert.match(migration, /first_release_mission/);
  assert.match(migration, /first_moment_approved/);
  assert.match(migration, /first_useful_recommendation/);
  assert.match(migration, /Only workspace owners or admins can change artist identity/);

  assert.match(intake, /Continue activation/);
  assert.match(intake, /musicIntakeMode/);
});

test("activation telemetry is append-only in meaning and idempotent by milestone", async () => {
  const migration = await read("supabase/migrations/20260905173000_artist_activation.sql");
  assert.match(migration, /on conflict \(artist_id, event_type\) do nothing/);
  assert.doesNotMatch(migration, /grant (insert|update|delete) on public\.artist_activation_events to authenticated/i);
  assert.match(migration, /grant select on public\.artist_activation_events to authenticated/);
});