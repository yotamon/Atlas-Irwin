import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("completed Track Intelligence continues only through exact canonical track lineage", async () => {
  const callback = await readFile("app/api/studio/growth/audio-callback/route.ts", "utf8");

  assert.ok(callback.includes('from "@/lib/music-intelligence/reconcile-canonical-track"'));
  assert.ok(callback.includes("trackId: track.linked_track_id"));
  assert.ok(callback.includes("ownerId: track.owner_id"));
  assert.ok(callback.includes("audioUrl: track.audio_url"));
  assert.ok(callback.includes("expectedOwnerId: input.ownerId"));
  assert.ok(callback.includes("expectedAudioUrl: input.audioUrl"));
  assert.equal(callback.includes("linked_release_id) scheduleCanonicalFollowUp"), false);
});

test("automatic ingestion persists one downstream progress model", async () => {
  const callback = await readFile("app/api/studio/growth/audio-callback/route.ts", "utf8");

  assert.ok(callback.includes("ingestion_follow_up"));
  assert.ok(callback.includes('status: "queued"'));
  assert.ok(callback.includes('return "needs_input" as const'));
  assert.ok(callback.includes('return "waiting" as const'));
  assert.ok(callback.includes('return "needs_attention" as const'));
  assert.ok(callback.includes('return "completed" as const'));
  assert.ok(callback.includes("currentRequestId !== input.requestId"));
});

test("canonical follow-up treats optional artist inputs as explicit non-error states", async () => {
  const reconciliation = await readFile("lib/music-intelligence/reconcile-canonical-track.ts", "utf8");

  assert.ok(reconciliation.includes('reason: "official_lyrics_missing"'));
  assert.ok(reconciliation.includes('reason: "ai_context_disabled"'));
  assert.ok(reconciliation.includes('reason: "instrumental"'));
  assert.ok(reconciliation.includes('reason: "no_stems"'));
  assert.ok(reconciliation.includes('reason: "stems_from_previous_master"'));
  assert.ok(reconciliation.includes('state: "failed"'));
  assert.ok(reconciliation.includes('cacheMode: "use"'));
  assert.ok(reconciliation.includes('stem.status === "ready"'));
  assert.ok(reconciliation.includes("regenerateSystemAudioScenes"));
});

test("canonical follow-up never guesses track identity and rejects master races", async () => {
  const reconciliation = await readFile("lib/music-intelligence/reconcile-canonical-track.ts", "utf8");

  assert.ok(reconciliation.includes('.eq("id", trackId)'));
  assert.ok(reconciliation.includes("trackResult.data.audio_url !== expectedAudioUrl"));
  assert.equal(reconciliation.includes("lower(t.title)"), false);
  assert.equal(reconciliation.includes("is_primary desc"), false);
  assert.equal(reconciliation.includes("order by"), false);
});
