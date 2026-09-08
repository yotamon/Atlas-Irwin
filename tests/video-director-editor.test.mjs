import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Director Pro is a music-aware editor instead of a settings stack", async () => {
  const workspace = await source("components/studio/video-director/project-workspace.tsx");
  const editor = await source("components/studio/video-director/editor/video-director-pro-editor.tsx");
  const css = await source("app/studio/design-system/video-editor.css");

  assert.match(workspace, /VideoDirectorProEditor/);
  assert.match(workspace, /Advanced production controls/);
  for (const surface of ["story", "media", "cast", "lyrics", "music"]) {
    assert.match(editor, new RegExp(`\\"${surface}\\"`));
  }
  assert.match(editor, /video-editor-timeline-content/);
  assert.match(editor, /smartSnapTime/);
  assert.match(editor, /updateVideoShotTiming/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /video-editor-workbench/);
  assert.match(css, /video-editor-playhead/);
  assert.match(css, /focus-visible/);
});

test("video editor consumes canonical lyrics and measured stem intelligence", async () => {
  const page = await source("app/studio/(protected)/video/[id]/page.tsx");
  const editor = await source("components/studio/video-director/editor/video-director-pro-editor.tsx");
  const stemLane = await source("components/studio/video-director/editor/stem-activity-lane.tsx");
  assert.match(page, /track_lyric_lines/);
  assert.match(page, /track_stems/);
  assert.match(page, /audio_scenes/);
  assert.match(page, /lyricCues/);
  assert.match(page, /audioScenes/);
  assert.match(editor, /StemActivityLane/);
  assert.match(stemLane, /activity_curve/);
  assert.match(stemLane, /rhythmic_activity/);
  assert.doesNotMatch(editor, /Array\.from\(\{ length: 28 \}/);
});

test("performance shots route through audio-reference-capable continuity models", async () => {
  const actions = await source("app/studio/video-editor-actions.ts");
  const router = await source("lib/video-director/model-router.ts");
  const provider = await source("lib/video-providers/higgsfield/client.ts");

  assert.match(actions, /performance_shot/);
  assert.match(actions, /requires_audio_reference/);
  assert.match(actions, /audio_references/);
  assert.match(actions, /performance_mode = "lip_sync"/);
  assert.match(actions, /generation_priority: parsed\.shotType === "performance" \? "consistency"/);
  assert.match(router, /profile\.performance_shot === true/);
  assert.match(router, /supportsAudioReferences/);
  assert.match(provider, /audio_reference/);
  assert.match(provider, /input\.audio_references/);
});

test("character identity is artist-scoped, reusable and cannot leak across artists", async () => {
  const migration = await source("supabase/migrations/20260908190000_video_director_pro_editor.sql");
  const actions = await source("app/studio/video-editor-actions.ts");
  const page = await source("app/studio/(protected)/video/[id]/page.tsx");

  assert.match(migration, /create table public\.music_video_characters/);
  assert.match(migration, /artist_id uuid not null references public\.artists/);
  assert.match(migration, /project_id uuid references public\.music_video_projects\(id\) on delete set null/);
  assert.match(migration, /Video character artist must match origin project artist/);
  assert.match(migration, /Video shot character must belong to the same artist as the project/);
  assert.match(actions, /artistCharacters/);
  assert.match(actions, /baseReferences/);
  assert.match(page, /music_video_characters.*artist_id/s);
});

test("A/B variants are quote-first, non-destructive and retain spend envelopes", async () => {
  const actions = await source("app/studio/video-editor-actions.ts");
  const lab = await source("components/studio/video-director/editor/shot-variant-lab.tsx");

  assert.match(actions, /prepareVideoShotVariant/);
  assert.match(actions, /approveAndGenerateVideoVariant/);
  assert.match(actions, /createApprovalEnvelope/);
  assert.match(actions, /submitApprovalEnvelope/);
  assert.match(actions, /selectVideoShotVariant/);
  assert.match(actions, /rejectVideoShotVariant/);
  const prepare = actions.slice(actions.indexOf("export async function prepareVideoShotVariant"), actions.indexOf("export async function approveAndGenerateVideoVariant"));
  assert.doesNotMatch(prepare, /selected_asset_id:\s*null/);
  assert.match(lab, /Preparing a take is free/);
  assert.match(lab, /Generate ·/);
  assert.match(lab, /WINNER/);
});

test("deterministic finishing turns measured music and timed lyrics into final pixels", async () => {
  const finishing = await source("lib/video-director/render-finishing.ts");
  const render = await source("lib/video-director/render.ts");
  const worker = await source("services/media-worker/app/video_director_finishing.py");
  const main = await source("services/media-worker/app/main.py");

  assert.match(finishing, /activity_curve/);
  assert.match(finishing, /buildShotReactiveEvents/);
  assert.match(finishing, /buildShotCaptionCues/);
  assert.match(finishing, /lip_sync_auto_pass_allowed: false/);
  assert.match(render, /reactive_events/);
  assert.match(render, /captions/);
  assert.match(render, /deterministic_finishing: true/);
  assert.match(worker, /drawtext=/);
  assert.match(worker, /eq=/);
  assert.match(worker, /enable='between\(t,/);
  assert.match(main, /build_video_director_filter/);
  assert.match(main, /clip_finishing/);
  assert.match(main, /review_frames/);
});

test("final delivery is fail-closed behind temporal QC and exact human lip-sync identity attestation", async () => {
  const gate = await source("supabase/migrations/20260908203000_video_director_human_quality_gate.sql");
  const humanAction = await source("app/studio/video-editor-quality-actions.ts");
  const quality = await source("lib/video-director/quality.ts");
  const reconciliation = await source("lib/video-director/render-quality-reconciliation.ts");
  const callback = await source("app/api/video-director/worker/callback/route.ts");

  assert.match(gate, /review_asset_id/);
  assert.match(gate, /lip_sync_approved/);
  assert.match(gate, /continuity_approved/);
  assert.match(gate, /ready_to_render/);
  assert.match(humanAction, /explicit_human_attestation/);
  assert.match(humanAction, /review_asset_id: shot\.selected_asset_id/);
  assert.match(quality, /Do NOT claim to verify phoneme-level lip-sync/);
  assert.match(quality, /not_assessed_from_sparse_frames/);
  assert.match(quality, /publishReady: passed && humanAttestationsValid/);
  assert.match(reconciliation, /status: "blocked"/);
  assert.match(callback, /reconcileVideoRenderQuality/);
  assert.match(callback, /quality\.publishReady/);
  const deliveryIndex = callback.indexOf("scheduleQuickVideoSocialDelivery");
  const qualityIndex = callback.lastIndexOf("reconcileVideoRenderQuality");
  const guardedDeliveryIndex = callback.lastIndexOf("scheduleQuickVideoSocialDelivery");
  assert.ok(qualityIndex >= 0 && guardedDeliveryIndex > qualityIndex, "social delivery must be downstream of final QC");
  assert.ok(deliveryIndex >= 0);
});

test("Source Auto-Edit is explainable, real-first, artist-scoped and non-destructive", async () => {
  const planner = await source("lib/video-director/source-auto-edit.ts");
  const actions = await source("app/studio/video-editor-actions.ts");
  const controls = await source("components/studio/video-director/editor/source-assembly-controls.tsx");

  assert.match(planner, /source-assembly-v1/);
  assert.match(planner, /generated provenance penalized while source media exists/);
  assert.match(planner, /metadata matches editorial intent/);
  assert.match(planner, /duration covers the shot/);
  assert.match(actions, /allowedProjectSourceAsset/);
  assert.match(actions, /\.eq\("artist_id", input\.artistId\)/);
  assert.match(actions, /planVideoSourceAssembly/);
  assert.match(actions, /source_suggestion/);
  const planning = actions.slice(actions.indexOf("export async function planVideoSourceAssembly"), actions.indexOf("export async function applyVideoSourceSuggestion"));
  assert.doesNotMatch(planning, /selected_asset_id:/);
  assert.match(controls, /It does not pretend to understand footage it has not visually analyzed/);
  assert.match(controls, /Use this source/);
  assert.match(controls, /Apply all suggestions to unresolved shots/);
  assert.match(controls, /Strong match/);
  assert.doesNotMatch(controls, /Math\.round\(.*confidence.*100/);
});

test("Program Monitor and final render share one master clock and source-in semantics", async () => {
  const editor = await source("components/studio/video-director/editor/video-director-pro-editor.tsx");
  const monitor = await source("components/studio/video-director/editor/program-monitor.tsx");
  const playback = await source("components/studio/video-director/editor/use-video-editor-playback.ts");
  const render = await source("lib/video-director/render.ts");

  assert.match(editor, /activeShot/);
  assert.match(editor, /ProgramMonitor/);
  assert.match(editor, /loopSelected/);
  assert.match(playback, /requestAnimationFrame/);
  assert.match(playback, /audio\.currentTime \* 1000/);
  assert.match(playback, /loop\.startMs/);
  assert.match(monitor, /source_offset_ms/);
  assert.match(monitor, /playheadMs - shot\.start_ms/);
  assert.match(monitor, /video\.currentTime = targetMs \/ 1000/);
  assert.match(render, /editorSourceOffsetMs/);
  assert.match(render, /source_offset_ms: editorSourceOffsetMs\(shot\) \+ Math\.max/);
});

test("editor keeps spend safety and exposes professional handoff instead of bypassing production", async () => {
  const workspace = await source("components/studio/video-director/project-workspace.tsx");
  const editor = await source("components/studio/video-director/editor/video-director-pro-editor.tsx");
  const exports = await source("lib/video-director/editor.ts");

  assert.match(workspace, /GenerationPanel/);
  assert.match(workspace, /ShotReviewPanel/);
  assert.match(workspace, /DeliveryPanel/);
  assert.match(editor, /hard_budget_credits/);
  assert.match(editor, /buildCmx3600Edl/);
  assert.match(editor, /buildFcpxml/);
  assert.match(exports, /TITLE:/);
  assert.match(exports, /<fcpxml version="1\.11">/);
});
