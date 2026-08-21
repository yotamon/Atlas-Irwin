import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("audio analysis uses semantic structure with an explicit fallback instead of a loudest-section hook", async () => {
  const analyzer = await readFile("services/media-worker/app/music_intelligence.py", "utf8");
  assert.ok(analyzer.includes("allin1_infer"));
  assert.ok(analyzer.includes('"semantic_structure": True'));
  assert.ok(analyzer.includes('"semantic_structure": False'));
  assert.ok(analyzer.includes("_build_hook_candidates"));
  assert.ok(analyzer.includes("repetition"));
  assert.ok(analyzer.includes("loopability"));
  assert.equal(analyzer.includes("highest_interior"), false);
});

test("music intelligence produces reusable short-form cuts", async () => {
  const analyzer = await readFile("services/media-worker/app/music_intelligence.py", "utf8");
  for (const duration of ["6000", "8000", "15000", "30000"]) {
    assert.ok(analyzer.includes(duration), `missing ${duration}ms social duration`);
  }
  assert.ok(analyzer.includes('"hook_candidates"'));
  assert.ok(analyzer.includes('"social_cuts"'));
});

test("Studio exposes a playable, explainable track intelligence inspector", async () => {
  const inspector = await readFile("components/studio/video-director/track-intelligence-inspector.tsx", "utf8");
  const workspace = await readFile("components/studio/video-director/project-workspace.tsx", "utf8");
  assert.ok(inspector.includes("<audio"));
  assert.ok(inspector.includes("hook score"));
  assert.ok(inspector.includes("Why this hook"));
  assert.ok(inspector.includes("Social cuts"));
  assert.ok(inspector.includes("Analysis diagnostics"));
  assert.ok(workspace.includes("TrackIntelligenceInspector"));
});

test("storyboard persistence snaps only to trustworthy musical timing", async () => {
  const planner = await readFile("lib/video-director/planner.ts", "utf8");
  assert.ok(planner.includes("alignProductionPlanToMusicMap"));
  assert.ok(planner.includes("map.analysis?.real_downbeats"));
  assert.ok(planner.includes("minimumShotMs"));
  assert.ok(planner.includes("structuralPoints"));
  assert.ok(planner.includes("starts_on_downbeat"));
});

test("derived renders prefer scored music windows", async () => {
  const renderer = await readFile("lib/video-director/render.ts", "utf8");
  assert.ok(renderer.includes("map?.social_cuts?.[durationKey]"));
  assert.ok(renderer.includes("map?.hook_candidates"));
  assert.ok(renderer.includes('source: "music_intelligence"'));
  assert.ok(renderer.includes("music_hook_candidate_id"));
});

test("track-level analysis is cached and can drive Content Lab timestamps", async () => {
  const migration = await readFile("supabase/migrations/20260821165000_track_music_intelligence.sql", "utf8");
  assert.ok(migration.includes("create table public.track_music_intelligence"));
  assert.ok(migration.includes("reuse_track_music_intelligence_for_worker_job"));
  assert.ok(migration.includes("apply_music_intelligence_to_content_item"));
  assert.ok(migration.includes("backfill_content_from_track_music_intelligence"));
  assert.ok(migration.includes("audio_timestamp_start"));
  assert.ok(migration.includes("audio_timestamp_end"));
});
