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
  assert.match(release, /never normalizes every song to one target/i);
});
