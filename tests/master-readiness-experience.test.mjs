import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function readinessModule() {
  const tsSource = await source("lib/mastering/readiness.ts");
  const compiled = ts.transpileModule(tsSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

function map({ status = "ready", issues = [], temporal = [], url = "https://audio/current.wav" } = {}) {
  return {
    source_audio: { url, audio_sha256: "abc123" },
    mastering_inspector: {
      schema: "ensemblis.mastering_inspector.v1",
      status,
      technical_ready: status !== "fix_before_release",
      issues,
      temporal_stability: { status: "completed", findings: temporal },
    },
  };
}

test("Master Readiness keeps a clean current waveform release-ready without recommending mastering", async () => {
  const { deriveMasterReadiness } = await readinessModule();
  const readiness = deriveMasterReadiness(map(), { audioUrl: "https://audio/current.wav" });
  assert.equal(readiness.status, "ready");
  assert.equal(readiness.distributionGate, "pass");
  assert.equal(readiness.primaryAction, "keep");
  assert.equal(readiness.sourceMatchesCurrent, true);
});

test("streaming headroom review routes to source-preserving mastering, not a generic preset", async () => {
  const { deriveMasterReadiness } = await readinessModule();
  const readiness = deriveMasterReadiness(map({
    status: "ready_review_suggested",
    issues: [{ severity: "review", category: "platform_risk", code: "codec_headroom", message: "Codec reconstruction leaves little headroom." }],
  }), { audioUrl: "https://audio/current.wav" });
  assert.equal(readiness.status, "review");
  assert.equal(readiness.distributionGate, "review");
  assert.equal(readiness.primaryAction, "mastering_fix");
  assert.equal(readiness.findings[0].masteringCanHelp, true);
});

test("source clipping blocks distribution and never pretends mastering can restore it", async () => {
  const { deriveMasterReadiness } = await readinessModule();
  const readiness = deriveMasterReadiness(map({
    status: "fix_before_release",
    issues: [{ severity: "critical", category: "technical_defect", code: "digital_clipping", message: "Clipping detected.", start_ms: 12000, end_ms: 15000 }],
  }), { audioUrl: "https://audio/current.wav" });
  assert.equal(readiness.status, "fix_required");
  assert.equal(readiness.distributionGate, "block");
  assert.equal(readiness.primaryAction, "repair_source");
  assert.equal(readiness.findings[0].masteringCanHelp, false);
});

test("readiness from a previous waveform is invalidated even when its old inspector said ready", async () => {
  const { deriveMasterReadiness } = await readinessModule();
  const readiness = deriveMasterReadiness(map({ url: "https://audio/old.wav" }), { audioUrl: "https://audio/new.wav" });
  assert.equal(readiness.status, "unavailable");
  assert.equal(readiness.distributionGate, "unverified");
  assert.equal(readiness.sourceMatchesCurrent, false);
});

test("temporal render changes remain localized review cues rather than technical blockers", async () => {
  const { deriveMasterReadiness } = await readinessModule();
  const readiness = deriveMasterReadiness(map({
    status: "ready_review_suggested",
    temporal: [{ severity: "review", code: "low_mid_buildup", message: "Low mids rise late.", start_ms: 150000, end_ms: 180000 }],
  }), { audioUrl: "https://audio/current.wav" });
  assert.equal(readiness.status, "review");
  assert.equal(readiness.distributionGate, "review");
  assert.equal(readiness.findings[0].category, "render_stability");
  assert.equal(readiness.findings[0].masteringCanHelp, false);
});

test("one PR enforces exact track lineage, trusted references and targeted streaming-safe mastering", async () => {
  const [actions, migration, processor, trackPage, controls, distribution, safeDistribution] = await Promise.all([
    source("app/studio/mastering-actions.ts"),
    source("supabase/migrations/20261001003000_master_readiness_experience.sql"),
    source("services/media-worker/app/mastering_processor.py"),
    source("app/studio/(protected)/music/[id]/page.tsx"),
    source("components/studio/active-mastering-controls.tsx"),
    source("lib/distribution/domain.ts"),
    source("app/studio/distribution-actions-safe.ts"),
  ]);

  assert.match(actions, /linked_track_id/);
  assert.match(actions, /no exact catalog-track lineage/);
  assert.doesNotMatch(actions, /find\(\(track\) => track\.is_primary\).*releaseTracks/);
  assert.match(actions, /mastering_references/);

  assert.match(migration, /'streaming_safe'/);
  assert.match(migration, /create table if not exists public\.mastering_references/);
  assert.match(migration, /new\.linked_track_id/);
  assert.match(migration, /having count\(\*\) = 1/);

  assert.match(processor, /preset == "streaming_safe"/);
  assert.match(processor, /reference_source = "source_preservation"/);
  assert.match(processor, /preserve_source/);

  const readinessPosition = trackPage.indexOf("<MasterReadinessCard");
  const workspacePosition = trackPage.indexOf("track-v5-workspace", readinessPosition);
  const activePosition = trackPage.indexOf("<ActiveMasteringPanel", workspacePosition);
  const technicalPosition = trackPage.indexOf("Engineering details", activePosition);
  assert.ok(readinessPosition > -1 && workspacePosition > readinessPosition && activePosition > workspacePosition && technicalPosition > activePosition);

  assert.match(controls, /Recommended fix/);
  assert.match(controls, /Create streaming-safe master/);
  assert.match(controls, /Explore a different mastering direction/);

  assert.match(distribution, /audio\.master_fix_required/);
  assert.match(distribution, /audio\.master_review_suggested/);
  assert.match(distribution, /masterReadinessByTrack/);
  assert.match(safeDistribution, /loadMasterReadinessByTrack/);
  assert.match(safeDistribution, /before Ensemblis prepares distribution/);
});

test("Active Mastering preserves canonical fidelity across bounded storage and never persists signed upload credentials", async () => {
  const [processor, jobs, callback, canonicalRoute, controls, panel, workerMain, automix] = await Promise.all([
    source("services/media-worker/app/mastering_processor.py"),
    source("lib/mastering/jobs.ts"),
    source("app/api/studio/mastering/callback/route.ts"),
    source("app/api/media/mastering/[jobId]/route.ts"),
    source("components/studio/active-mastering-controls.tsx"),
    source("components/studio/active-mastering-panel.tsx"),
    source("services/media-worker/app/main.py"),
    source("services/media-worker/app/automix.py"),
  ]);

  assert.match(processor, /MAX_MASTERING_UPLOAD_BYTES = 48_000_000/);
  assert.match(processor, /MASTERING_CHUNK_BYTES = 45_000_000/);
  assert.match(processor, /"-c:a", "flac"/);
  assert.match(processor, /"storage_mode": "chunked_lossless"/);
  assert.match(processor, /def _split_mastering_chunks/);
  assert.match(processor, /def _upload_mastering_output/);
  assert.match(processor, /"source_precision_preserved": True/);
  assert.doesNotMatch(processor, /dither_method=triangular/);
  assert.doesNotMatch(processor, /flac_16_/);
  assert.match(jobs, /masteringChunkPaths/);
  assert.match(jobs, /chunk_uploads: chunkSlots/);
  assert.match(callback, /delete next\.chunk_uploads/);
  assert.match(callback, /chunk_manifest/);
  assert.match(callback, /asset_type: "master_audio"/);
  assert.match(callback, /verifiedForDistribution \? "distribution-ready" : "review-required"/);
  assert.match(canonicalRoute, /Accept-Ranges/);
  assert.match(canonicalRoute, /Content-Range/);
  assert.match(canonicalRoute, /chunk\.storage_path/);
  assert.match(canonicalRoute, /response\.status === 200 && !wantsWholeChunk/);
  assert.match(controls, /Retry \{failed\.preset/);
  assert.doesNotMatch(controls, /Download 24-bit WAV/);
  assert.doesNotMatch(panel, /Download rendered WAV/);
  assert.match(workerMain, /Never include response\.url here/);
  assert.match(workerMain, /Media upload failed/);
  const uploadGuard = workerMain.match(/def raise_upload_error[\s\S]*?async def upload_file/)?.[0] ?? "";
  assert.doesNotMatch(uploadGuard, /raise_for_status/);
  assert.match(automix, /worker_main\.raise_upload_error\(response\)/);
});

test("temporal stability uses musical boundaries and never claims AI artifact detection", async () => {
  const inspector = await source("services/media-worker/app/mastering_inspector.py");
  assert.match(inspector, /def _temporal_stability/);
  assert.match(inspector, /high_frequency_detail_drop/);
  assert.match(inspector, /low_mid_buildup/);
  assert.match(inspector, /transient_contrast_drop/);
  assert.match(inspector, /_section_boundary_distance/);
  assert.match(inspector, /audition cues, not AI-authorship claims/);
  assert.doesNotMatch(inspector, /AI artifact detected/i);
});

test("Listen Lab keeps matched A/B comparison and finding audition accessible", async () => {
  const [lab, card] = await Promise.all([
    source("components/studio/mastering-listen-lab.tsx"),
    source("components/studio/master-readiness-card.tsx"),
  ]);
  assert.match(lab, /checked=\{loudnessMatch\}/);
  assert.match(lab, /A · Original/);
  assert.match(lab, /B · Candidate/);
  assert.match(lab, /Loop 12s/);
  assert.match(lab, /const key = event\.key\.toLowerCase\(\)/);
  assert.match(lab, /key === "a"/);
  assert.match(lab, /key === "b"/);
  assert.match(lab, /key === "m"/);
  assert.match(lab, /key === "r"/);
  assert.match(lab, /createChannelSplitter\(2\)/);
  assert.match(lab, /Candidate mono/);
  assert.match(lab, /Reference track/);
  assert.match(card, /aria-pressed=\{activeFinding\?\.code === finding\.code\}/);
  assert.match(card, /Stop loop/);
});



test("external mastering references reuse the canonical audio worker without creating Music tracks", async () => {
  const [queue, callback, uploader, actions, migration, grantsMigration, indexMigration] = await Promise.all([
    source("lib/mastering/reference-jobs.ts"),
    source("app/api/studio/mastering/references/callback/route.ts"),
    source("components/studio/media-uploader.tsx"),
    source("app/studio/mastering-reference-actions.ts"),
    source("supabase/migrations/20261001003000_master_readiness_experience.sql"),
    source("supabase/migrations/20261001003001_mastering_references_data_api_grants.sql"),
    source("supabase/migrations/20261001004317_mastering_reference_fk_indexes.sql"),
  ]);

  assert.match(queue, /jobType: "analyze_audio"/);
  assert.match(queue, /activeCapabilitiesForOwner\(reference\.owner_id\)/);
  assert.match(queue, /mastering\/references\/callback/);
  assert.match(queue, /status: "pending"/);
  assert.match(queue, /status: "queued"/);

  assert.match(callback, /sourceUrl !== reference\.audio_url/);
  assert.match(callback, /reference_signature/);
  assert.match(callback, /source_fingerprint/);
  assert.match(callback, /audio_sha256/);

  assert.match(uploader, /masteringReferenceMode/);
  assert.match(uploader, /createUploadedMasteringReference/);
  assert.match(uploader, /does not add it to Music/);
  const referenceAttach = uploader.indexOf("if (referenceIntake)");
  const vaultAttach = uploader.indexOf("if (masterIntake)", referenceAttach);
  assert.ok(referenceAttach > -1 && vaultAttach > referenceAttach, "reference intake and Music intake must remain separate branches");

  assert.match(actions, /kind: "uploaded_reference"/);
  assert.match(actions, /media_asset_id/);
  assert.match(actions, /kickMasteringReferenceQueue/);
  assert.match(migration, /mastering_references_pending_idx/);
  assert.match(migration, /mastering_references_uploaded_asset_uidx/);
  assert.match(grantsMigration, /revoke all on table public\.mastering_references from anon/);
  assert.match(grantsMigration, /grant select, insert, update, delete on table public\.mastering_references to authenticated/);
  assert.match(grantsMigration, /grant all on table public\.mastering_references to service_role/);
  assert.match(grantsMigration, /to authenticated/);
  assert.match(grantsMigration, /\(select auth\.uid\(\)\) = owner_id/);
  assert.match(indexMigration, /mastering_references_track_vault_idx/);
  assert.match(indexMigration, /on public\.mastering_references\(track_vault_id\)/);
  assert.match(indexMigration, /mastering_references_media_asset_idx/);
  assert.match(indexMigration, /on public\.mastering_references\(media_asset_id\)/);
});

test("Mastering reference UI exposes analysis lifecycle and automatic refresh", async () => {
  const panel = await source("components/studio/mastering-references-panel.tsx");
  assert.match(panel, /AnalysisAutoRefresh active=\{active\}/);
  assert.match(panel, /Analyzing/);
  assert.match(panel, /Needs retry/);
  assert.match(panel, /Add an external reference/);
  assert.match(panel, /masteringReferenceMode/);
  assert.match(panel, /Use this approved master as a reference/);
});

