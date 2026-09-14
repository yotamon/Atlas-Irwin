import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("stranded Music ingestion follow-ups have a bounded durable recovery path", async () => {
  const recovery = await readFile("lib/music-intelligence/ingestion-follow-up.ts", "utf8");
  const heartbeat = await readFile("app/api/cron/marketing/route.ts", "utf8");

  assert.ok(recovery.includes("FOLLOW_UP_RECOVERY_GRACE_MS"));
  assert.ok(recovery.includes('followUp.status !== "queued" && followUp.status !== "waiting"'));
  assert.ok(recovery.includes("return { recovered: true, vaultTrackId: track.id }"));
  assert.ok(recovery.includes("expectedAudioUrl: target.audioUrl"));
  assert.ok(recovery.includes("currentRequestId !== target.requestId"));
  assert.ok(recovery.includes("current.data.linked_track_id !== target.trackId"));
  assert.ok(heartbeat.includes("recoverStrandedMusicIngestionFollowUp"));
  assert.ok(heartbeat.includes('runStep("music ingestion follow-up"'));
});

test("exact track workspace exposes Needs You only through the shared ingestion model", async () => {
  const workspace = await readFile("app/studio/(protected)/music/[id]/page.tsx", "utf8");

  assert.ok(workspace.includes("describeMusicIngestionProgress"));
  assert.ok(workspace.includes('ingestion.phase === "needs_input"'));
  assert.ok(workspace.includes('ingestion.inputReason === "official_lyrics_missing"'));
  assert.ok(workspace.includes('ingestion.inputReason === "ai_context_disabled"'));
  assert.ok(workspace.includes('ingestion.inputReason === "stems_from_previous_master"'));
  assert.ok(workspace.includes("Needs You ·"));
  assert.equal(workspace.includes(">Run Track Intelligence<"), false);
  assert.ok(workspace.includes("Advanced analysis controls"));
});
