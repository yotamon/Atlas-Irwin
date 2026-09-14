import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("completed Track Intelligence continues only through exact canonical track lineage", async () => {
  const callback = await readFile("app/api/studio/growth/audio-callback/route.ts", "utf8");

  assert.ok(callback.includes('import { reconcileCanonicalTrackIntelligence } from "@/lib/music-intelligence/reconcile-canonical-track"'));
  assert.ok(callback.includes("if (track.linked_track_id) scheduleCanonicalFollowUp(track.linked_track_id, track.owner_id);"));
  assert.ok(callback.includes("expectedOwnerId: ownerId"));
  assert.equal(callback.includes("linked_release_id) scheduleCanonicalFollowUp"), false);
});

test("canonical follow-up treats optional artist inputs as explicit non-error states", async () => {
  const reconciliation = await readFile("lib/music-intelligence/reconcile-canonical-track.ts", "utf8");

  assert.ok(reconciliation.includes('reason: "official_lyrics_missing"'));
  assert.ok(reconciliation.includes('reason: "ai_context_disabled"'));
  assert.ok(reconciliation.includes('reason: "instrumental"'));
  assert.ok(reconciliation.includes('reason: "no_stems"'));
  assert.ok(reconciliation.includes('reason: "stems_from_previous_master"'));
  assert.ok(reconciliation.includes('cacheMode: "use"'));
  assert.ok(reconciliation.includes('stem.status === "ready"'));
  assert.ok(reconciliation.includes("regenerateSystemAudioScenes"));
});

test("canonical follow-up never guesses track identity from title or release ordering", async () => {
  const reconciliation = await readFile("lib/music-intelligence/reconcile-canonical-track.ts", "utf8");

  assert.ok(reconciliation.includes('.eq("id", trackId)'));
  assert.equal(reconciliation.includes("lower(t.title)"), false);
  assert.equal(reconciliation.includes("is_primary desc"), false);
  assert.equal(reconciliation.includes("order by"), false);
});
