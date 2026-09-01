import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(path, "utf8");
}

test("Stem Intelligence is exact-master bound and invalidates derived state", async () => {
  const migration = await source("supabase/migrations/20260901112545_stem_intelligence.sql");
  const callback = await source("app/api/studio/stems/callback/route.ts");

  assert.ok(migration.includes("source_master_url text not null"));
  assert.ok(migration.includes("Stem must be bound to the current canonical master"));
  assert.ok(migration.includes("invalidate_stem_intelligence_on_audio_change"));
  assert.ok(migration.includes("set status = 'stale'"));
  assert.ok(migration.includes("preview_asset_id = null"));
  assert.ok(migration.includes("status = 'cancelled'"));

  assert.ok(callback.includes("trackAudioUrl !== expectedMasterUrl"));
  assert.ok(callback.includes("previous canonical master and was discarded"));
  assert.ok(callback.includes("stem_set_fingerprint"));
  assert.ok(callback.includes("Stem set changed while the Audio Scene preview was rendering"));
});

test("Audio Scenes are non-destructive recipes with canonical-master Full Impact", async () => {
  const scenes = await source("lib/music-intelligence/stems.ts");

  assert.ok(scenes.includes('schema: "atlas.audio_scene.v1"'));
  assert.ok(scenes.includes('sceneType: "vocal_spotlight"'));
  assert.ok(scenes.includes('sceneType: "groove"'));
  assert.ok(scenes.includes('sceneType: "atmosphere"'));
  assert.ok(scenes.includes('sceneType: "voiceover_bed"'));
  assert.ok(scenes.includes('sceneType: "progressive_reveal"'));
  assert.ok(scenes.includes('sceneType: "vocal_to_drop"'));
  assert.ok(scenes.includes('sceneType: "full_impact"'));
  assert.ok(scenes.includes('{ source: "master", gain_db: 0 }'));
  assert.ok(scenes.includes("The canonical mastered track"));
});

test("vocal scenes preserve the complete vocal stack instead of selecting one vocal stem", async () => {
  const scenes = await source("lib/music-intelligence/stems.ts");

  assert.ok(scenes.includes("const used = [...vocals, ...supporting]"));
  assert.ok(scenes.includes("...vocals.map((stem) => stemLayer(stem, 0))"));
  assert.ok(scenes.includes("vocal_stem_ids: vocals.map((stem) => stem.id)"));
  assert.ok(scenes.includes("const revealGroups"));
  assert.ok(scenes.includes("...(vocals.length ? [vocals] : [])"));
  assert.ok(scenes.includes("...vocals.map((stem) => ({ ...stemLayer(stem, 0), end_at_ms: transitionMs + 120"));
  assert.ok(scenes.includes("complete vocal stack"));
});

test("Audio Scenes audition live from aligned sources and render only for portable files", async () => {
  const player = await source("components/studio/audio-scene-live-player.tsx");
  const panel = await source("components/studio/stem-intelligence-panel.tsx");
  const mixer = await source("components/studio/stem-custom-mixer.tsx");

  assert.ok(player.includes("createMediaElementSource"));
  assert.ok(player.includes("sourceOffsetMs"));
  assert.ok(player.includes("startAtMs"));
  assert.ok(player.includes("fadeInMs"));
  assert.ok(player.includes("fadeOutMs"));
  assert.ok(player.includes('new CustomEvent("atlas-audio-scene-play"'));
  assert.ok(player.includes("Play live mix"));
  assert.ok(panel.includes("<AudioSceneLivePlayer"));
  assert.ok(panel.includes("No preview render is required"));
  assert.ok(panel.includes("Create audio file"));
  assert.equal(panel.includes("Render preview"), false);
  assert.ok(panel.includes('queued: "Waiting"'));
  assert.ok(panel.includes('analyzing: "Analyzing now"'));
  assert.ok(mixer.includes("<AudioSceneLivePlayer"));
  assert.ok(mixer.includes("Audition is live"));
});

test("Stem analysis records musical usefulness and explicit alignment confidence", async () => {
  const analyzer = await source("services/media-worker/app/stem_intelligence.py");
  const worker = await source("services/media-worker/app/main.py");

  for (const signal of [
    "energy",
    "active_ratio",
    "rhythmic_activity",
    "groove_score",
    "loopability",
    "hook_score",
    "section_activity",
    "best_moments",
    "alignment",
  ]) assert.ok(analyzer.includes(signal), `missing stem signal ${signal}`);

  assert.ok(analyzer.includes('"onset_cross_correlation"'));
  assert.ok(analyzer.includes('"duration_guard"'));
  assert.ok(analyzer.includes("_alignment("));
  assert.ok(analyzer.includes("confidence < 0.28"));
  assert.ok(worker.includes('elif request.job_type == "analyze_stem"'));
  assert.ok(worker.includes('elif request.job_type == "render_audio_scene"'));
  assert.ok(worker.includes("gain_reduction_db"));
});

test("Stem jobs share the durable Media Worker queue and callback credential model", async () => {
  const queue = await source("lib/media-worker/queue.ts");
  const sandbox = await source("lib/media-worker/sandbox.ts");
  const callback = await source("app/api/studio/stems/callback/route.ts");

  assert.ok(queue.includes('from("track_stem_jobs")'));
  assert.ok(queue.includes('`${getSiteUrl()}/api/studio/stems/callback`'));
  assert.ok(queue.includes("freshStemState"));
  assert.ok(queue.includes("dispatchStemJob"));
  assert.ok(queue.includes("videoActive || vaultState.active || stemState.active"));
  assert.ok(sandbox.includes('"analyze_stem"'));
  assert.ok(sandbox.includes('"render_audio_scene"'));
  assert.ok(sandbox.includes("stem_intelligence.py"));
  assert.ok(sandbox.includes('export PYTHONPATH="$WORKDIR"'));
  assert.ok(sandbox.indexOf('export PYTHONPATH="$WORKDIR"') < sandbox.indexOf("from app.stem_intelligence import ANALYSIS_VERSION"));
  assert.ok(callback.includes("MEDIA_WORKER_CALLBACK_HASH_KEY"));
  assert.ok(callback.includes("timingSafeEqual"));
});

test("queued scene renders refresh credentials and stem reclassification refreshes analysis", async () => {
  const queue = await source("lib/media-worker/queue.ts");
  const actions = await source("app/studio/stem-actions.ts");

  assert.ok(queue.includes("prepareStemPayloadForDispatch"));
  assert.ok(queue.includes("createSignedUploadUrl(path)"));
  assert.ok(queue.includes("Audio Scene render job is missing its upload destination"));
  assert.equal(actions.includes("createSignedUploadUrl(path)"), false);

  const identityStart = actions.indexOf("export async function updateStemIdentity");
  const identityEnd = actions.indexOf("export async function removeTrackStem");
  assert.ok(identityStart >= 0 && identityEnd > identityStart);
  const identityAction = actions.slice(identityStart, identityEnd);
  assert.ok(identityAction.includes("categoryChanged"));
  assert.ok(identityAction.includes('status: "cancelled"'));
  assert.ok(identityAction.includes("analysis: json({})"));
  assert.ok(identityAction.includes("await enqueueStemAnalysis"));
});

test("Stem Intelligence is integrated into release UX, campaign creative context, and Video Director", async () => {
  const masterPanel = await source("components/studio/release-master-audio-panel.tsx");
  const stemPanel = await source("components/studio/stem-intelligence-panel.tsx");
  const creative = await source("lib/marketing/creative-context.ts");
  const videoContext = await source("lib/video-director/context.ts");

  assert.ok(masterPanel.includes("<StemIntelligencePanel"));
  assert.ok(stemPanel.includes("Import stems from Suno or your DAW"));
  assert.ok(stemPanel.includes("Audio Scenes"));
  assert.ok(stemPanel.includes("Advanced custom mixer"));

  assert.ok(creative.includes("selectedAudioScene"));
  assert.ok(creative.includes("sceneFit"));
  assert.ok(creative.includes("Artist-selected Audio Scene for this content item"));
  assert.ok(creative.includes("MUSICAL DIRECTION:"));
  assert.ok(creative.includes("progressive reveal"));

  assert.ok(videoContext.includes("stem_intelligence"));
  assert.ok(videoContext.includes("full music video still follows the canonical master"));
});

test("Stem files remain first-class Media Library assets with explicit lineage", async () => {
  const actions = await source("app/studio/stem-actions.ts");
  const uploader = await source("components/studio/stem-uploader.tsx");
  const callback = await source("app/api/studio/stems/callback/route.ts");

  assert.ok(actions.includes('asset.asset_type !== "stem"'));
  assert.ok(actions.includes('role: "stem"'));
  assert.ok(uploader.includes('targetForm.set("asset_type", "stem")'));
  assert.ok(uploader.includes("crypto.subtle.digest"));
  assert.ok(callback.includes('source_kind: "audio_scene_render"'));
  assert.ok(callback.includes("source_master_url"));
  assert.ok(callback.includes("audio_scene_id"));
});
