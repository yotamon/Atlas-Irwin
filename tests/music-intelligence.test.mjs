import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

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

test("release workspace owns master upload and reuses the same music intelligence pipeline", async () => {
  const releaseWorkspace = await readFile("components/studio/release-workspace-v2.tsx", "utf8");
  const panel = await readFile("components/studio/release-master-audio-panel.tsx", "utf8");
  const uploader = await readFile("components/studio/media-uploader.tsx", "utf8");
  const actions = await readFile("app/studio/growth-media-actions.ts", "utf8");
  const callback = await readFile("app/api/studio/growth/audio-callback/route.ts", "utf8");

  assert.ok(releaseWorkspace.includes("ReleaseMasterAudioPanel"));
  assert.ok(releaseWorkspace.includes('href:"#master-audio"'));
  assert.ok(panel.includes("MusicIntelligencePreview"));
  assert.ok(panel.includes("AnalysisAutoRefresh"));
  assert.ok(panel.includes("Replace master audio"));
  assert.ok(panel.includes("analysisFailureCopy"));
  assert.equal(panel.includes('analysis.message ? `: ${analysis.message}`'), false);
  assert.ok(uploader.includes("releaseMasterMode"));
  assert.ok(uploader.includes("attachReleaseMasterFromMedia"));
  assert.ok(actions.includes("analysisReused"));
  assert.ok(actions.includes("request_id"));
  assert.ok(callback.includes("stale: true"));
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

test("production Media Worker is self-bootstrapping, zero-idle and Sandbox-native", async () => {
  const worker = await readFile("services/media-worker/app/main.py", "utf8");
  const runner = await readFile("services/media-worker/app/runner.py", "utf8");
  const bridge = await readFile("lib/media-worker/sandbox.ts", "utf8");
  const vaultBridge = await readFile("lib/studio/vault-analysis.ts", "utf8");
  const health = await readFile("app/api/health/media-worker/route.ts", "utf8");
  const callback = await readFile("app/api/studio/growth/audio-callback/route.ts", "utf8");

  assert.ok(worker.includes("from .music_intelligence import"));
  assert.ok(worker.includes("imageio_ffmpeg.get_ffmpeg_exe"));
  assert.ok(runner.includes("request_path.unlink"));
  assert.ok(runner.includes("shutil.rmtree(LOCK_PATH"));
  assert.ok(bridge.includes('runtime: "python3.13"'));
  assert.ok(bridge.includes("resources: { vcpus: 4 }"));
  assert.ok(bridge.includes("persistent: true"));
  assert.ok(bridge.includes("keepLastSnapshots: { count: 1 }"));
  assert.ok(bridge.includes("detached: true"));
  assert.ok(bridge.includes("MEDIA_WORKER_CALLBACK_HASH_KEY"));
  assert.ok(bridge.includes("atlas-media-worker-${environmentName()}"));
  assert.ok(bridge.includes("MEDIA_WORKER_RUNTIME_VERSION = 5"));
  assert.ok(bridge.includes("MEDIA_WORKER_BOOTSTRAP_VERSION = 2"));
  assert.ok(bridge.includes("venv --without-pip"));
  assert.ok(bridge.includes("https://bootstrap.pypa.io/get-pip.py"));
  assert.ok(bridge.includes('"pip==25.2"'));
  assert.equal(bridge.includes("-m ensurepip"), false);
  assert.ok(bridge.includes(".requirements.sha"));
  assert.ok(bridge.indexOf('printf \'%s\' "$required" > "$WORKDIR/.requirements.sha"') > bridge.indexOf("import allin1_infer"));
  assert.ok(vaultBridge.includes('jobType: "analyze_audio"'));
  assert.ok(health.includes('dispatch_mode: readiness.runtime'));
  assert.ok(health.includes("zero_idle_compute: true"));
  assert.ok(callback.includes("scheduleMediaWorkerSandboxCleanup"));
});

test("active Media Worker code cannot regress to Google Cloud infrastructure", async () => {
  const activePaths = [
    ".env.example",
    "package.json",
    ".github/workflows/ci.yml",
    "lib/media-worker/sandbox.ts",
    "lib/studio/vault-analysis.ts",
    "lib/video-director/worker.ts",
    "app/studio/growth-media-actions.ts",
    "app/api/studio/growth/audio-callback/route.ts",
    "app/api/video-director/worker/callback/route.ts",
    "app/api/health/media-worker/route.ts",
    "services/media-worker/app/main.py",
    "services/media-worker/app/runner.py",
    "services/media-worker/requirements.txt",
  ];
  const sources = await Promise.all(activePaths.map(async (path) => [path, await readFile(path, "utf8")]));
  const banned = [
    "GCP_PROJECT_ID",
    "CLOUD_TASKS_",
    "google-cloud-tasks",
    "google.cloud",
    "gcloud ",
    "MEDIA_WORKER_URL",
    "MEDIA_WORKER_SECRET",
  ];

  for (const [path, source] of sources) {
    for (const token of banned) {
      assert.equal(source.includes(token), false, `${path} contains obsolete external-worker token ${token}`);
    }
  }

  await assert.rejects(access("scripts/deploy-media-worker.mjs"));
  await assert.rejects(access("services/media-worker/Dockerfile"));
});
