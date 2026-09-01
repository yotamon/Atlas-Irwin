import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("Track Intelligence v3 uses model evidence plus explicit DSP fallback", async () => {
  const analyzer = await readFile("services/media-worker/app/music_intelligence.py", "utf8");
  assert.ok(analyzer.includes("ANALYSIS_VERSION = 3"));
  assert.ok(analyzer.includes("include_activations=True"));
  assert.ok(analyzer.includes("include_embeddings=True"));
  assert.ok(analyzer.includes('"semantic_structure": True'));
  assert.ok(analyzer.includes('"semantic_structure": False'));
  assert.ok(analyzer.includes("_build_hook_candidates"));
  assert.ok(analyzer.includes("semantic_recurrence"));
  assert.ok(analyzer.includes("harmonic_distinctiveness"));
  assert.ok(analyzer.includes("boundary_loop_fit"));
  assert.ok(analyzer.includes('"real_downbeats": downbeat_source == "model"'));
  assert.equal(analyzer.includes("highest_interior"), false);
});

test("v3 produces purpose-specific moments and multiple reusable social alternatives", async () => {
  const analyzer = await readFile("services/media-worker/app/music_intelligence.py", "utf8");
  for (const duration of ["6000", "8000", "15000", "30000"]) {
    assert.ok(analyzer.includes(duration), `missing ${duration}ms social duration`);
  }
  for (const intent of ["instant_hook", "musical_identity", "groove_loop", "build_drop", "climax", "story_arc"]) {
    assert.ok(analyzer.includes(`"${intent}"`), `missing ${intent} production intent`);
  }
  assert.ok(analyzer.includes('"hook_candidates"'));
  assert.ok(analyzer.includes('"moments"'));
  assert.ok(analyzer.includes('"social_cuts"'));
  assert.ok(analyzer.includes('"social_cut_options"'));
  assert.ok(analyzer.includes("_social_objective"));
});

test("v3 analysis is cryptographically bound to the exact source master", async () => {
  const worker = await readFile("services/media-worker/app/main.py", "utf8");
  const vaultCallback = await readFile("app/api/studio/growth/audio-callback/route.ts", "utf8");
  const videoCallback = await readFile("app/api/video-director/worker/callback/route.ts", "utf8");
  const migration = await readFile("supabase/migrations/20260901150000_track_intelligence_v3.sql", "utf8");
  assert.ok(worker.includes("sha256_file"));
  assert.ok(worker.includes('"audio_sha256": source_sha256'));
  assert.ok(worker.includes('"analysis_pcm_sha256": analysis_sha256'));
  assert.ok(worker.includes('"source_media_asset_id"'));
  assert.ok(vaultCallback.includes("sourceMatchesTrack"));
  assert.ok(vaultCallback.includes("source_master_mismatch"));
  assert.ok(videoCallback.includes("analysisMatchesCurrentMaster"));
  assert.ok(videoCallback.includes("previous track master"));
  assert.ok(migration.includes("source_audio_url"));
  assert.ok(migration.includes("source_media_asset_id"));
  assert.ok(migration.includes("audio_sha256"));
  assert.ok(migration.includes("invalidate_track_music_intelligence_on_audio_change"));
});

test("master QC measures release-critical audio properties", async () => {
  const analyzer = await readFile("services/media-worker/app/music_intelligence.py", "utf8");
  const requirements = await readFile("services/media-worker/requirements.txt", "utf8");
  assert.ok(requirements.includes("pyloudnorm==0.1.1"));
  assert.ok(analyzer.includes("integrated_lufs"));
  assert.ok(analyzer.includes("true_peak_dbtp"));
  assert.ok(analyzer.includes("clipping_samples"));
  assert.ok(analyzer.includes("stereo_correlation"));
  assert.ok(analyzer.includes("leading_silence_ms"));
  assert.ok(analyzer.includes("technical_ready"));
});

test("Studio exposes a playable, explainable v3 production review inspector", async () => {
  const inspector = await readFile("components/studio/video-director/track-intelligence-inspector.tsx", "utf8");
  const workspace = await readFile("components/studio/video-director/project-workspace.tsx", "utf8");
  assert.ok(inspector.includes("<audio"));
  assert.ok(inspector.includes("Production intent"));
  assert.ok(inspector.includes("Master QC"));
  assert.ok(inspector.includes("Alternate social cuts"));
  assert.ok(inspector.includes("Analysis confidence"));
  assert.ok(inspector.includes("Upgrade this track to v3"));
  assert.ok(workspace.includes("TrackIntelligenceInspector"));
});

test("release workspace queues the same canonical analysis pipeline without a second direct worker path", async () => {
  const releaseWorkspace = await readFile("components/studio/release-workspace-v2.tsx", "utf8");
  const panel = await readFile("components/studio/release-master-audio-panel.tsx", "utf8");
  const uploader = await readFile("components/studio/media-uploader.tsx", "utf8");
  const actions = await readFile("app/studio/growth-media-actions.ts", "utf8");
  const callback = await readFile("app/api/studio/growth/audio-callback/route.ts", "utf8");
  const vaultBridge = await readFile("lib/studio/vault-analysis.ts", "utf8");

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
  assert.ok(actions.includes("kickMediaWorkerQueue"));
  assert.ok(actions.includes("source_media_asset_id"));
  assert.equal(actions.includes("queueVaultAudioAnalysis"), false);
  assert.equal(vaultBridge.includes("dispatchMediaWorkerJob"), false);
  assert.ok(callback.includes("stale: true"));
});

test("Media Worker contention is a durable queue, not an analysis failure", async () => {
  const queue = await readFile("lib/media-worker/queue.ts", "utf8");
  const worker = await readFile("lib/video-director/worker.ts", "utf8");
  const sandbox = await readFile("lib/media-worker/sandbox.ts", "utf8");
  assert.ok(queue.includes('status: "planned"'));
  assert.ok(queue.includes('status: "queued"'));
  assert.ok(queue.includes("busyError"));
  assert.ok(queue.includes("kickMediaWorkerQueue"));
  assert.ok(queue.includes("vaultQueueState"));
  assert.ok(worker.includes("kickMediaWorkerQueue"));
  assert.equal(worker.includes("already processing another job. Atlas keeps concurrency at 1"), false);
  assert.ok(sandbox.includes('import("@/lib/media-worker/queue")'));
});

test("storyboard persistence snaps only to trustworthy musical timing", async () => {
  const planner = await readFile("lib/video-director/planner.ts", "utf8");
  assert.ok(planner.includes("alignProductionPlanToMusicMap"));
  assert.ok(planner.includes("map.analysis?.real_downbeats"));
  assert.ok(planner.includes("minimumShotMs"));
  assert.ok(planner.includes("structuralPoints"));
  assert.ok(planner.includes("starts_on_downbeat"));
});

test("derived renders prefer duration-specific scored music windows", async () => {
  const renderer = await readFile("lib/video-director/render.ts", "utf8");
  assert.ok(renderer.includes("map?.social_cuts?.[durationKey]"));
  assert.ok(renderer.includes("map?.hook_candidates"));
  assert.ok(renderer.includes('source: "music_intelligence"'));
  assert.ok(renderer.includes("music_hook_candidate_id"));
});

test("v3 cache and Content Lab timestamp provenance are exact-master only", async () => {
  const baseMigration = await readFile("supabase/migrations/20260821165000_track_music_intelligence.sql", "utf8");
  const migration = await readFile("supabase/migrations/20260901150000_track_intelligence_v3.sql", "utf8");
  const hardening = await readFile("supabase/migrations/20260901151000_track_intelligence_v3_hardening.sql", "utf8");
  assert.ok(baseMigration.includes("create table public.track_music_intelligence"));
  assert.ok(migration.includes("analysis_version >= 3"));
  assert.ok(migration.includes("audio_timestamp_source"));
  assert.ok(migration.includes("audio_timestamp_candidate_id"));
  assert.ok(migration.includes("audio_timestamp_analysis_version"));
  assert.ok(hardening.includes("music_intelligence_cut_for_content"));
  assert.ok(hardening.includes("i.source_audio_url is not distinct from t.audio_url"));
  assert.ok(hardening.includes("audio_timestamp_source = 'manual'"));
});

test("production Media Worker remains self-bootstrapping, zero-idle and Sandbox-native", async () => {
  const worker = await readFile("services/media-worker/app/main.py", "utf8");
  const runner = await readFile("services/media-worker/app/runner.py", "utf8");
  const bridge = await readFile("lib/media-worker/sandbox.ts", "utf8");
  const queue = await readFile("lib/media-worker/queue.ts", "utf8");
  const health = await readFile("app/api/health/media-worker/route.ts", "utf8");
  const callback = await readFile("app/api/studio/growth/audio-callback/route.ts", "utf8");

  assert.ok(worker.includes("from .music_intelligence import"));
  assert.ok(worker.includes("imageio_ffmpeg.get_ffmpeg_exe"));
  assert.ok(runner.includes("request_path.unlink"));
  assert.ok(runner.includes("shutil.rmtree(LOCK_PATH"));
  assert.ok(bridge.includes("vercel/sandbox/universal@sha256:"));
  assert.ok(bridge.includes('MEDIA_WORKER_PYTHON_VERSION = "3.13.14"'));
  assert.ok(bridge.includes("resources: { vcpus: 4 }"));
  assert.ok(bridge.includes("persistent: true"));
  assert.ok(bridge.includes("keepLastSnapshots: { count: 1 }"));
  assert.ok(bridge.includes("detached: true"));
  assert.ok(bridge.includes("MEDIA_WORKER_CALLBACK_HASH_KEY"));
  assert.ok(bridge.includes("atlas-media-worker-${environmentName()}"));
  assert.ok(bridge.includes("MEDIA_WORKER_RUNTIME_VERSION = 7"));
  assert.ok(bridge.includes("MEDIA_WORKER_BOOTSTRAP_VERSION = 4"));
  assert.ok(bridge.includes('uv python install "$PYTHON_VERSION"'));
  assert.ok(bridge.includes('uv venv --python "$PYTHON_VERSION"'));
  assert.ok(bridge.includes('uv pip install --python "$WORKDIR/.venv/bin/python"'));
  assert.ok(bridge.includes("import bz2"));
  assert.ok(bridge.includes('cd "$WORKDIR"'));
  assert.ok(bridge.indexOf('cd "$WORKDIR"') < bridge.indexOf('-m app.runner "$REQUEST"'));
  assert.equal(bridge.includes("bootstrap.pypa.io/get-pip.py"), false);
  assert.equal(bridge.includes('runtime: "python3.13"'), false);
  assert.ok(bridge.includes(".requirements.sha"));
  assert.ok(bridge.indexOf('printf \'%s\' "$required" > "$WORKDIR/.requirements.sha"') > bridge.indexOf("import allin1_infer"));
  assert.ok(queue.includes('jobType: "analyze_audio"'));
  assert.ok(health.includes('dispatch_mode: readiness.runtime'));
  assert.ok(health.includes("sandbox_image: readiness.sandboxImage"));
  assert.ok(health.includes("zero_idle_compute: true"));
  assert.ok(callback.includes("scheduleMediaWorkerSandboxCleanup"));
});

test("active Media Worker code cannot regress to Google Cloud infrastructure", async () => {
  const activePaths = [
    ".env.example",
    "package.json",
    ".github/workflows/ci.yml",
    "lib/media-worker/sandbox.ts",
    "lib/media-worker/queue.ts",
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
