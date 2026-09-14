import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("completed Track Intelligence continues through exact canonical lineage", async () => {
  const callback = await readFile("app/api/studio/growth/audio-callback/route.ts", "utf8");
  const reconciliation = await readFile("lib/music-intelligence/reconcile-canonical-track.ts", "utf8");

  assert.ok(callback.includes("trackId: track.linked_track_id"));
  assert.ok(callback.includes("audioUrl: track.audio_url"));
  assert.ok(callback.includes("expectedOwnerId: input.ownerId"));
  assert.ok(callback.includes("expectedAudioUrl: input.audioUrl"));
  assert.ok(reconciliation.includes("trackResult.data.audio_url !== expectedAudioUrl"));
});

test("automatic ingestion persists and exposes one progress model", async () => {
  const callback = await readFile("app/api/studio/growth/audio-callback/route.ts", "utf8");
  const progress = await readFile("lib/studio/track-analysis-state.ts", "utf8");
  const workspace = await readFile("components/studio/music-workspace-overview.tsx", "utf8");

  assert.ok(callback.includes("ingestion_follow_up"));
  assert.ok(callback.includes('status: "queued"'));
  assert.ok(progress.includes("export function describeMusicIngestionProgress"));
  assert.ok(progress.includes('label: "Finishing context"'));
  assert.ok(progress.includes('label: "Core intelligence ready"'));
  assert.ok(workspace.includes("describeMusicIngestionProgress"));
  assert.ok(workspace.includes("progress.progress"));
});

test("optional artist inputs remain explicit non-error states", async () => {
  const reconciliation = await readFile("lib/music-intelligence/reconcile-canonical-track.ts", "utf8");

  for (const marker of [
    'reason: "official_lyrics_missing"',
    'reason: "ai_context_disabled"',
    'reason: "instrumental"',
    'reason: "no_stems"',
    'reason: "stems_from_previous_master"',
    'state: "failed"',
    'cacheMode: "use"',
    'stem.status === "ready"',
    "regenerateSystemAudioScenes",
  ]) {
    assert.ok(reconciliation.includes(marker), marker);
  }

  assert.equal(reconciliation.includes("lower(t.title)"), false);
  assert.equal(reconciliation.includes("is_primary desc"), false);
});
