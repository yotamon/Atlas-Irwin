import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function typescriptModule(path) {
  const tsSource = await source(path);
  const compiled = ts.transpileModule(tsSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

function musicMap({
  lufs = -10,
  peak = -1.2,
  plr = 11,
  correlation = 0.7,
  tonalShift = 0,
} = {}) {
  return {
    mastering_inspector: {
      loudness: { integrated_lufs: lufs, true_peak_dbtp: peak },
      dynamics: { peak_to_loudness_ratio_lu: plr },
      stereo: { correlation },
      reference_signature: {
        perceptual_envelope_db: {
          bass_80_160: -8 + tonalShift,
          low_mid_315_630: -10 + tonalShift,
          mid_630_1250: -9 + tonalShift,
          presence_2500_4000: -12 + tonalShift,
          air_6000_10000: -17 + tonalShift,
        },
      },
    },
  };
}

test("release mastering preserves intentional relationships instead of equalizing every track", async () => {
  const { deriveReleaseMasteringCoherence } = await typescriptModule("lib/mastering/release-coherence.ts");
  const result = deriveReleaseMasteringCoherence([
    { id: "a", title: "A", musicMap: musicMap({ lufs: -10.5, plr: 12 }) },
    { id: "b", title: "B", musicMap: musicMap({ lufs: -9.8, plr: 11 }) },
    { id: "c", title: "C", musicMap: musicMap({ lufs: -11.0, plr: 12.5 }) },
  ]);

  assert.equal(result.status, "coherent");
  assert.equal(result.relationships.length, 2);
  assert.equal(result.policy.normalizeEveryTrackToSameLufs, false);
  assert.equal(result.policy.preservesIntentionalContrast, true);
  assert.equal(result.policy.automaticCrossTrackProcessing, false);
  assert.equal(result.relationships[0].loudnessDeltaLu, 0.7);
});

test("release mastering localizes large sequence contrasts for listening review", async () => {
  const { deriveReleaseMasteringCoherence } = await typescriptModule("lib/mastering/release-coherence.ts");
  const result = deriveReleaseMasteringCoherence([
    { id: "a", title: "A", musicMap: musicMap({ lufs: -10, plr: 11 }) },
    { id: "b", title: "B", musicMap: musicMap({ lufs: -10.4, plr: 10.8 }) },
    { id: "c", title: "C", musicMap: musicMap({ lufs: -16, plr: 17, correlation: 0.1, tonalShift: 5 }) },
  ]);

  assert.equal(result.status, "review");
  const codes = new Set(result.findings.map((finding) => finding.code));
  assert.ok(codes.has("loudness_outlier"));
  assert.ok(codes.has("dynamics_outlier"));
  assert.ok(result.findings.every((finding) => finding.severity === "review"));
});

test("mastering preference profile only learns from explicit candidate decisions", async () => {
  const { buildMasteringPreferenceProfile } = await typescriptModule("lib/mastering/preferences.ts");
  const result = buildMasteringPreferenceProfile([
    {
      id: "approved",
      preset: "balanced",
      result_payload: {
        artist_decision: { decision: "approved", decided_at: "2026-10-01T10:00:00Z" },
        after: { loudness: { integrated_lufs: -10.2 } },
        final_checks: { perceptual_delta: { plr_loss_lu: 0.7, estimated_limiter_gain_reduction_db: 1.2 } },
        plan: { tonal: { total_eq_energy: 1.6 }, stereo: { enabled: false } },
      },
    },
    {
      id: "kept",
      preset: "punchy",
      result_payload: {
        artist_decision: { decision: "kept_original", decided_at: "2026-10-01T11:00:00Z" },
        after: { loudness: { integrated_lufs: -9.2 } },
        final_checks: { perceptual_delta: { plr_loss_lu: 1.5, estimated_limiter_gain_reduction_db: 3.0 } },
        plan: { tonal: { total_eq_energy: 3.0 }, stereo: { enabled: true } },
      },
    },
    {
      id: "passive",
      preset: "dynamic",
      result_payload: { after: { loudness: { integrated_lufs: -11.0 } } },
    },
  ]);

  assert.equal(result.evidenceCount, 2);
  assert.equal(result.approvedCount, 1);
  assert.equal(result.keptOriginalCount, 1);
  assert.equal(result.preferredCreativeLufs, -10.2);
  assert.equal(result.latestDecisionAt, "2026-10-01T11:00:00Z");
  assert.equal(result.boundedInfluence.mayLoosenTechnicalSafety, false);
});

test("Active Mastering V2 keeps white-box DSP, damage gates and bounded optimization explicit", async () => {
  const [processor, inspector, candidates, references, preferences, controls, release] = await Promise.all([
    source("services/media-worker/app/mastering_processor.py"),
    source("services/media-worker/app/mastering_inspector.py"),
    source("services/media-worker/app/mastering_candidates.py"),
    source("services/media-worker/app/mastering_references.py"),
    source("services/media-worker/app/mastering_preferences.py"),
    source("components/studio/active-mastering-controls.tsx"),
    source("components/studio/release-mastering-coherence.tsx"),
  ]);

  assert.match(processor, /ffmpeg_oversampled_alimiter/);
  assert.match(processor, /include_codec_stress=False/);
  assert.match(processor, /select_candidate/);
  assert.doesNotMatch(processor, /def _render_loudnorm/);
  assert.match(inspector, /perceptual_envelope_db/);
  assert.match(inspector, /transient_crest_p90_db/);
  assert.match(candidates, /_damage_penalty/);
  assert.match(candidates, /full_pass/);
  assert.match(references, /score_reference_similarity/);
  assert.match(references, /_section_similarity/);
  assert.match(preferences, /technical_safety_may_be_loosened": False/);
  assert.match(controls, /Keep original/);
  assert.match(controls, /suggestedLoops/);
  assert.match(controls, /Artist Mastering DNA influenced this candidate/);
  assert.match(release, /never normalizes every song to one target/i);
});

test("chunked canonical mastering media validates exact byte continuity and HTTP ranges", async () => {
  const {
    masteringChunkManifest,
    parseMasteringRange,
    masteringRangeHeaders,
  } = await typescriptModule("lib/mastering/chunked-media.ts");

  const valid = masteringChunkManifest([
    { index: 0, storage_path: "mastering/a/b/c/job/chunks/part-000.bin", offset: 0, size: 45 },
    { index: 1, storage_path: "mastering/a/b/c/job/chunks/part-001.bin", offset: 45, size: 30 },
  ], 75);
  assert.equal(valid.length, 2);

  assert.equal(masteringChunkManifest([
    { index: 0, storage_path: "mastering/a/b/c/job/chunks/part-000.bin", offset: 0, size: 45 },
    { index: 1, storage_path: "mastering/a/b/c/job/chunks/part-001.bin", offset: 46, size: 29 },
  ], 75), null);

  assert.equal(masteringChunkManifest([
    { index: 0, storage_path: "../chunks/part-000.bin", offset: 0, size: 75 },
  ], 75), null);

  assert.deepEqual(parseMasteringRange(null, 75), { start: 0, end: 74, partial: false });
  assert.deepEqual(parseMasteringRange("bytes=40-60", 75), { start: 40, end: 60, partial: true });
  assert.deepEqual(parseMasteringRange("bytes=-10", 75), { start: 65, end: 74, partial: true });
  assert.equal(parseMasteringRange("bytes=75-", 75), null);
  assert.equal(parseMasteringRange("bytes=10-5", 75), null);

  const headers = masteringRangeHeaders({
    total: 75,
    start: 40,
    end: 60,
    partial: true,
    etag: "abc",
  });
  assert.equal(headers.get("content-length"), "21");
  assert.equal(headers.get("content-range"), "bytes 40-60/75");
  assert.equal(headers.get("accept-ranges"), "bytes");
  assert.equal(headers.get("etag"), "\"abc\"");
});

test("mastering failure paths retain storage lineage so uploaded chunks can be cleaned", async () => {
  const [processor, callback] = await Promise.all([
    source("services/media-worker/app/mastering_processor.py"),
    source("app/api/studio/mastering/callback/route.ts"),
  ]);
  assert.match(processor, /_callback\(request, "failed", result, message\)/);
  assert.match(callback, /status === "failed"[\s\S]*cleanupUploadedMaster\(service, requestPayload, result\)/);
});

test("mastering decisions are immutable preference evidence", async () => {
  const actions = await source("app/studio/mastering-actions.ts");
  assert.match(actions, /already approved as the canonical master/);
  assert.match(actions, /already chose to keep the original/);
  assert.match(actions, /deduplicated: true/);
});

test("uploaded mastering references stay private and use fresh signed reads", async () => {
  const [uploader, catalog, referenceActions, referenceJobs, referenceCallback] = await Promise.all([
    source("components/studio/media-uploader.tsx"),
    source("app/studio/catalog-actions-internal.ts"),
    source("app/studio/mastering-reference-actions.ts"),
    source("lib/mastering/reference-jobs.ts"),
    source("app/api/studio/mastering/references/callback/route.ts"),
  ]);

  assert.match(uploader, /storage_scope", referenceIntake \? "mastering_reference" : "public"/);
  assert.match(uploader, /visibility: uploadTarget\.visibility/);
  assert.match(catalog, /"studio-private"/);
  assert.match(catalog, /mastering-references/);
  assert.match(referenceActions, /asset\.visibility === "public" \? asset\.public_url : null/);
  assert.match(referenceJobs, /createSignedUrl\(asset\.storage_path, 60 \* 60\)/);
  assert.match(referenceJobs, /sourceIdentityUrl = `media-asset:\$\{asset\.id\}`/);
  assert.match(referenceCallback, /reference\.media_asset_id[\s\S]*sourceAssetId !== reference\.media_asset_id/);
});

test("selected masters expose real AAC and Opus audition assets without replacing canonical audio", async () => {
  const [jobs, processor, callback, controls, listenLab] = await Promise.all([
    source("lib/mastering/jobs.ts"),
    source("services/media-worker/app/mastering_processor.py"),
    source("app/api/studio/mastering/callback/route.ts"),
    source("components/studio/active-mastering-controls.tsx"),
    source("components/studio/mastering-listen-lab.tsx"),
  ]);

  assert.match(jobs, /aac_256/);
  assert.match(jobs, /opus_160/);
  assert.match(processor, /_render_and_upload_codec_previews/);
  assert.match(processor, /source": "exact_selected_master"/);
  assert.match(callback, /codec_preview_uploads/);
  assert.match(controls, /codecPreviews=\{codecPreviews\}/);
  assert.match(listenLab, /Hear real codec stress previews/);
  assert.match(listenLab, /never replace the lossless canonical master/);
});

test("master readiness separates source repair, streaming safety and ready-as-is states", async () => {
  const { deriveMasterReadiness } = await typescriptModule("lib/mastering/readiness.ts");

  const base = {
    source_audio: { url: "https://example.test/master.flac", audio_sha256: "abc" },
    mastering_inspector: {
      schema: "ensemblis.mastering_inspector.v2",
      technical_ready: true,
      status: "ready",
      issues: [],
      temporal_stability: { findings: [] },
    },
  };
  const current = { audioUrl: "https://example.test/master.flac" };

  assert.equal(deriveMasterReadiness(base, current).masterability, "ready_as_is");

  const streaming = structuredClone(base);
  streaming.mastering_inspector.status = "ready_review_suggested";
  streaming.mastering_inspector.issues = [{
    code: "codec_headroom",
    severity: "review",
    category: "platform_risk",
    message: "Codec headroom is tight.",
  }];
  assert.equal(deriveMasterReadiness(streaming, current).masterability, "streaming_safety_only");

  const mix = structuredClone(base);
  mix.mastering_inspector.status = "ready_review_suggested";
  mix.mastering_inspector.issues = [{
    code: "wide_low_end",
    severity: "review",
    category: "creative_observation",
    message: "Low end is unusually wide.",
  }];
  assert.equal(deriveMasterReadiness(mix, current).masterability, "mix_review_recommended");

  const broken = structuredClone(base);
  broken.mastering_inspector.status = "fix_before_release";
  broken.mastering_inspector.technical_ready = false;
  broken.mastering_inspector.issues = [{
    code: "digital_clipping",
    severity: "critical",
    category: "technical_defect",
    message: "Clipping.",
  }];
  assert.equal(deriveMasterReadiness(broken, current).masterability, "source_repair_required");
});

test("server refuses mastering over blocking source defects", async () => {
  const [actions, controls] = await Promise.all([
    source("app/studio/mastering-actions.ts"),
    source("components/studio/active-mastering-controls.tsx"),
  ]);
  assert.match(actions, /readiness\.masterability === "source_repair_required"/);
  assert.match(actions, /will not master over a blocking source defect/);
  assert.match(controls, /masteringStage === "source"/);
  assert.match(controls, /Fix the source before creating a new master/);
  assert.match(controls, /masteringStage === "recommendation"/);
});

test("private mastering references use temporary signed URLs for Listen Lab playback", async () => {
  const panel = await source("components/studio/active-mastering-panel.tsx");
  assert.match(panel, /select\("label,audio_url,media_asset_id,reference_signature,track_vault_id,created_at"\)/);
  assert.match(panel, /asset\?\.visibility === "private"/);
  assert.match(panel, /createSignedUrl\(asset\.storage_path, 60 \* 60\)/);
  assert.doesNotMatch(panel, /\.not\("audio_url", "is", null\)/);
});
