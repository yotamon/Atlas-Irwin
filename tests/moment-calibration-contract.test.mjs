import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MOMENT_CALIBRATION_MAX_ABS_DELTA,
  calibrationMatchesMoment,
  latestExactMomentCalibration,
  momentCalibrationDelta,
} from "../lib/studio/moment-calibration.ts";

const OWNER = "00000000-0000-4000-8000-000000000001";
const ARTIST = "00000000-0000-4000-8000-000000000002";
const RELEASE = "00000000-0000-4000-8000-000000000003";
const TRACK = "00000000-0000-4000-8000-000000000004";

function moment(index, overrides = {}) {
  const start = overrides.start_ms ?? index * 30_000;
  const end = overrides.end_ms ?? start + 16_000;
  return {
    id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    owner_id: OWNER,
    artist_id: ARTIST,
    release_id: RELEASE,
    track_id: TRACK,
    start_ms: start,
    end_ms: end,
    source_start_ms: overrides.source_start_ms ?? start,
    source_end_ms: overrides.source_end_ms ?? end,
    moment_type: "hook",
    label: overrides.label ?? `Moment ${index}`,
    source_mode: "audio",
    source_fingerprint: overrides.source_fingerprint ?? `source-${index}`,
    purpose_tags: ["hook"],
    energy_score: overrides.energy_score ?? 0.72,
    hook_score: overrides.hook_score ?? 0.78,
    emotional_score: overrides.emotional_score ?? 0.62,
    vocal_score: overrides.vocal_score ?? 0.66,
    uniqueness_score: overrides.uniqueness_score ?? 0.64,
    confidence: overrides.confidence ?? 0.76,
    track_analysis_version: overrides.track_analysis_version ?? 4,
    track_analysis_audio_sha256: overrides.track_analysis_audio_sha256 ?? "master-sha",
    source_candidate_id: `candidate-${index}`,
    lyric_moment_id: null,
    lyrics_version: null,
    audio_scene_id: null,
    audio_scene_recipe_version: null,
    evidence: {},
    state: overrides.state ?? "proposed",
    reviewed_by: null,
    reviewed_at: null,
    superseded_by_id: null,
    created_at: "2026-09-06T10:00:00.000Z",
    updated_at: "2026-09-06T10:00:00.000Z",
  };
}

function calibration(momentRow, index, overrides = {}) {
  return {
    id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    owner_id: momentRow.owner_id,
    artist_id: momentRow.artist_id,
    release_id: momentRow.release_id,
    track_id: momentRow.track_id,
    moment_id: momentRow.id,
    moment_source_fingerprint: overrides.moment_source_fingerprint ?? momentRow.source_fingerprint,
    moment_track_analysis_version: overrides.moment_track_analysis_version ?? momentRow.track_analysis_version,
    moment_track_analysis_audio_sha256: overrides.moment_track_analysis_audio_sha256 ?? momentRow.track_analysis_audio_sha256,
    source_start_ms: overrides.source_start_ms ?? momentRow.source_start_ms,
    source_end_ms: overrides.source_end_ms ?? momentRow.source_end_ms,
    previous_start_ms: momentRow.start_ms,
    previous_end_ms: momentRow.end_ms,
    effective_start_ms: momentRow.start_ms,
    effective_end_ms: momentRow.end_ms,
    judgment: overrides.judgment ?? "best",
    corrected_purpose: overrides.corrected_purpose ?? null,
    preferred_cut_seconds: overrides.preferred_cut_seconds ?? null,
    preferred_moment_id: overrides.preferred_moment_id ?? null,
    preferred_moment_source_fingerprint: overrides.preferred_moment_source_fingerprint ?? null,
    evidence: {},
    created_by: OWNER,
    created_at: overrides.created_at ?? `2026-09-06T10:${String(index).padStart(2, "0")}:00.000Z`,
  };
}

test("calibration only matches the exact Moment analyzer/master provenance", () => {
  const target = moment(1);
  const exact = calibration(target, 1);
  const staleFingerprint = calibration(target, 2, { moment_source_fingerprint: "old-source" });
  const staleVersion = calibration(target, 3, { moment_track_analysis_version: 3 });
  const staleMaster = calibration(target, 4, { moment_track_analysis_audio_sha256: "old-master" });

  assert.equal(calibrationMatchesMoment(exact, target), true);
  assert.equal(calibrationMatchesMoment(staleFingerprint, target), false);
  assert.equal(calibrationMatchesMoment(staleVersion, target), false);
  assert.equal(calibrationMatchesMoment(staleMaster, target), false);
  assert.equal(momentCalibrationDelta(target, [staleFingerprint, staleVersion, staleMaster], [target]), 0);
});

test("only the latest exact judgment is active rather than accumulating history", () => {
  const target = moment(2);
  const olderBest = calibration(target, 1, { judgment: "best", created_at: "2026-09-06T10:00:00.000Z" });
  const newerPoor = calibration(target, 2, { judgment: "poor", created_at: "2026-09-06T11:00:00.000Z" });

  assert.equal(latestExactMomentCalibration(target, [olderBest, newerPoor])?.id, newerPoor.id);
  assert.equal(momentCalibrationDelta(target, [olderBest, newerPoor], [target]), -0.18);
});

test("explicit preference for another Moment is bounded on both sides", () => {
  const source = moment(3);
  const preferred = moment(4);
  const sourceEvent = calibration(source, 1, {
    judgment: "useful",
    preferred_moment_id: preferred.id,
    preferred_moment_source_fingerprint: preferred.source_fingerprint,
  });
  const preferredBest = calibration(preferred, 2, { judgment: "best" });
  const events = [sourceEvent, preferredBest];
  const all = [source, preferred];

  assert.ok(Math.abs(momentCalibrationDelta(source, events, all) - 0.02) < 1e-9);
  assert.equal(momentCalibrationDelta(preferred, events, all), MOMENT_CALIBRATION_MAX_ABS_DELTA);
});

test("artist calibration participates before the final five-Moment ranking", async () => {
  const curator = await readFile(new URL("../lib/studio/moments-calibrated-curator.ts", import.meta.url), "utf8");
  const applyIndex = curator.indexOf("applyMomentCalibrationScore(");
  const floorIndex = curator.indexOf(".filter((moment) =>", applyIndex);
  const sortIndex = curator.indexOf(".sort((left, right)", floorIndex);
  const sliceIndex = curator.indexOf(".slice(0, Math.max(1, maxResults))", sortIndex);

  assert.ok(applyIndex >= 0, "calibration must contribute to curated Moment score");
  assert.ok(floorIndex > applyIndex, "calibration must happen before final quality eligibility");
  assert.ok(sortIndex > floorIndex, "calibrated eligible Moments must be ranked after calibration");
  assert.ok(sliceIndex > sortIndex, "Top 5 truncation must happen only after calibrated ranking");
  assert.match(curator, /calibration\?\.judgment === "best"/);
  assert.match(curator, /calibration\?\.judgment === "useful"/);
});

test("Moment review UX is evidence-first and calibration is append-only for product clients", async () => {
  const [panel, action, migration, evaluator, memory] = await Promise.all([
    readFile(new URL("../components/studio/moment-review-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/moment-actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260906170000_moment_calibration.sql", import.meta.url), "utf8"),
    readFile(new URL("../scripts/evaluate-track-intelligence.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/artist-memory/domain.ts", import.meta.url), "utf8"),
  ]);

  assert.match(panel, /Best Moment/);
  assert.match(panel, /Useful/);
  assert.match(panel, /Not for me/);
  assert.match(panel, /preferred_moment_id/);
  assert.match(panel, /preferred_cut_seconds/);
  assert.match(panel, /corrected_purpose/);
  assert.doesNotMatch(panel, /% quality/);
  assert.doesNotMatch(panel, /quality_score\s*\*\s*100/);

  assert.match(action, /review_moment_with_calibration/);
  assert.doesNotMatch(action, /\.from\("moments"\)[\s\S]*\.update\(/);

  assert.match(migration, /moment_calibration_events/);
  assert.match(migration, /moment_track_analysis_audio_sha256/);
  assert.match(migration, /revoke all on table public\.moment_calibration_events from anon, authenticated/);
  assert.match(migration, /sole append path/);
  assert.match(migration, /greatest\([\s\S]*-0\.20/);
  assert.match(migration, /least\(0\.20/);

  assert.match(evaluator, /artist_preference_acceptance/);
  assert.match(evaluator, /min_artist_preference_acceptance/);
  assert.match(memory, /moment_calibration/);
  assert.match(memory, /preference_evidence/);
});
