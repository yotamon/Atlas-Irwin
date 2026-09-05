#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function usage() {
  console.error("Usage: node scripts/evaluate-track-intelligence.mjs <benchmark-manifest.json>");
  process.exit(2);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function overlapScore(a, b) {
  const start = Math.max(a.start_ms, b.start_ms);
  const end = Math.min(a.end_ms, b.end_ms);
  const intersection = Math.max(0, end - start);
  if (!intersection) return 0;
  const lenA = Math.max(1, a.end_ms - a.start_ms);
  const lenB = Math.max(1, b.end_ms - b.start_ms);
  const union = lenA + lenB - intersection;
  return Math.max(intersection / union, intersection / Math.min(lenA, lenB));
}

function windowMatches(predicted, expected, threshold = 0.5) {
  return expected.some((window) => overlapScore(predicted, window) >= threshold);
}

function nearestBoundaryError(predicted, expected) {
  if (!predicted.length || !expected.length) return [];
  return expected.map((boundary) => Math.min(...predicted.map((candidate) => Math.abs(candidate - boundary))));
}

function predictedMomentWindows(map, intent) {
  const refs = map?.moments?.[intent];
  return Array.isArray(refs)
    ? refs.filter((item) => finite(item?.start_ms) && finite(item?.end_ms))
    : [];
}

function canonicalMoments(map) {
  const moments = Array.isArray(map?.musical_moments) && map.musical_moments.length
    ? map.musical_moments
    : map?.hook_candidates;
  return Array.isArray(moments)
    ? moments.filter((item) => finite(item?.start_ms) && finite(item?.end_ms)).slice(0, 5)
    : [];
}

function socialOptions(map, duration) {
  const options = map?.social_cut_options?.[String(duration)];
  if (Array.isArray(options) && options.length) return options;
  const primary = map?.social_cuts?.[String(duration)];
  return primary ? [primary] : [];
}

function allExpectedMomentWindows(fixture) {
  const explicit = Array.isArray(fixture.preferred_moments) ? fixture.preferred_moments : [];
  const perIntent = Object.values(fixture.preferred_windows ?? {}).flatMap((value) => Array.isArray(value) ? value : []);
  return [...explicit, ...perIntent].filter((item) => finite(item?.start_ms) && finite(item?.end_ms));
}

function momentCompleteness(moment) {
  if (finite(moment?.musical_completeness)) return moment.musical_completeness;
  if (finite(moment?.metrics?.musical_completeness)) return moment.metrics.musical_completeness;
  return null;
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function evaluateThresholds(summary, thresholds = {}) {
  const failures = [];
  if (finite(thresholds.max_bpm_mae) && finite(summary.bpm_mae) && summary.bpm_mae > thresholds.max_bpm_mae) {
    failures.push(`BPM MAE ${summary.bpm_mae.toFixed(2)} > ${thresholds.max_bpm_mae}`);
  }
  if (finite(thresholds.max_section_boundary_median_ms) && finite(summary.section_boundary_median_ms)
      && summary.section_boundary_median_ms > thresholds.max_section_boundary_median_ms) {
    failures.push(`Section boundary median ${Math.round(summary.section_boundary_median_ms)}ms > ${thresholds.max_section_boundary_median_ms}ms`);
  }
  if (finite(thresholds.min_moment_top3_recall) && finite(summary.moment_top3_recall)
      && summary.moment_top3_recall < thresholds.min_moment_top3_recall) {
    failures.push(`Moment top-3 recall ${(summary.moment_top3_recall * 100).toFixed(1)}% < ${(thresholds.min_moment_top3_recall * 100).toFixed(1)}%`);
  }
  if (finite(thresholds.min_social_top3_recall) && finite(summary.social_top3_recall)
      && summary.social_top3_recall < thresholds.min_social_top3_recall) {
    failures.push(`Social top-3 recall ${(summary.social_top3_recall * 100).toFixed(1)}% < ${(thresholds.min_social_top3_recall * 100).toFixed(1)}%`);
  }
  if (finite(thresholds.min_top5_usable_recall) && finite(summary.top5_usable_recall)
      && summary.top5_usable_recall < thresholds.min_top5_usable_recall) {
    failures.push(`Top-5 production-usable recall ${(summary.top5_usable_recall * 100).toFixed(1)}% < ${(thresholds.min_top5_usable_recall * 100).toFixed(1)}%`);
  }
  if (finite(thresholds.min_musical_completeness) && finite(summary.musical_completeness_mean)
      && summary.musical_completeness_mean < thresholds.min_musical_completeness) {
    failures.push(`Mean musical completeness ${summary.musical_completeness_mean.toFixed(3)} < ${thresholds.min_musical_completeness}`);
  }
  if (finite(thresholds.min_boundary_constrained_social_ratio) && finite(summary.boundary_constrained_social_ratio)
      && summary.boundary_constrained_social_ratio < thresholds.min_boundary_constrained_social_ratio) {
    failures.push(`Boundary-constrained social ratio ${(summary.boundary_constrained_social_ratio * 100).toFixed(1)}% < ${(thresholds.min_boundary_constrained_social_ratio * 100).toFixed(1)}%`);
  }
  return failures;
}

const manifestArg = process.argv[2];
if (!manifestArg) usage();
const manifestPath = resolve(process.cwd(), manifestArg);
const manifest = await loadJson(manifestPath);
if (!Array.isArray(manifest.tracks) || !manifest.tracks.length) {
  throw new Error("Benchmark manifest must contain a non-empty tracks array.");
}

const baseDir = dirname(manifestPath);
const bpmErrors = [];
const sectionErrors = [];
const completenessScores = [];
let momentExpected = 0;
let momentTop1Hits = 0;
let momentTop3Hits = 0;
let socialExpected = 0;
let socialTop1Hits = 0;
let socialTop3Hits = 0;
let usableExpected = 0;
let usableHits = 0;
let socialOptionCount = 0;
let boundaryConstrainedSocialCount = 0;
const diversityScores = [];
const tracks = [];

for (const fixture of manifest.tracks) {
  if (!fixture.analysis) throw new Error(`Track ${fixture.id ?? "unknown"} has no analysis path.`);
  const map = await loadJson(resolve(baseDir, fixture.analysis));
  const row = { id: fixture.id ?? fixture.analysis };

  if (finite(fixture.expected_bpm) && finite(map.bpm)) {
    const error = Math.abs(map.bpm - fixture.expected_bpm);
    bpmErrors.push(error);
    row.bpm_error = error;
  }

  if (Array.isArray(fixture.section_boundaries_ms) && fixture.section_boundaries_ms.length) {
    const predicted = (map.sections ?? []).slice(1).map((section) => section.start_ms).filter(finite);
    const errors = nearestBoundaryError(predicted, fixture.section_boundaries_ms.filter(finite));
    sectionErrors.push(...errors);
    row.section_boundary_median_ms = median(errors);
  }

  row.moments = {};
  for (const [intent, expected] of Object.entries(fixture.preferred_windows ?? {})) {
    if (!Array.isArray(expected) || !expected.length) continue;
    momentExpected += 1;
    const predicted = predictedMomentWindows(map, intent);
    const top1 = predicted[0] ? windowMatches(predicted[0], expected) : false;
    const top3 = predicted.slice(0, 3).some((window) => windowMatches(window, expected));
    if (top1) momentTop1Hits += 1;
    if (top3) momentTop3Hits += 1;
    row.moments[intent] = { top1, top3 };
  }

  row.social = {};
  for (const [duration, expected] of Object.entries(fixture.preferred_social_cuts ?? {})) {
    if (!Array.isArray(expected) || !expected.length) continue;
    socialExpected += 1;
    const predicted = socialOptions(map, duration);
    const top1 = predicted[0] ? windowMatches(predicted[0], expected) : false;
    const top3 = predicted.slice(0, 3).some((window) => windowMatches(window, expected));
    if (top1) socialTop1Hits += 1;
    if (top3) socialTop3Hits += 1;
    row.social[duration] = { top1, top3 };
  }

  const canonical = canonicalMoments(map);
  const expectedUsable = allExpectedMomentWindows(fixture);
  if (expectedUsable.length) {
    usableExpected += 1;
    const hit = canonical.some((moment) => windowMatches(moment, expectedUsable));
    if (hit) usableHits += 1;
    row.top5_usable = hit;
  }
  for (const moment of canonical) {
    const completeness = momentCompleteness(moment);
    if (finite(completeness)) completenessScores.push(completeness);
  }
  if (canonical.length) {
    const identities = new Set(canonical.map((moment) => `${moment.kind ?? "unknown"}:${moment.section_id ?? moment.section_label ?? "unknown"}`));
    const diversity = identities.size / canonical.length;
    diversityScores.push(diversity);
    row.moment_diversity = diversity;
  }

  for (const duration of [6, 8, 15, 30]) {
    for (const option of socialOptions(map, duration)) {
      socialOptionCount += 1;
      if (option?.musical_boundary_constrained === true || map.version < 4) boundaryConstrainedSocialCount += 1;
    }
  }

  tracks.push(row);
}

const summary = {
  tracks: manifest.tracks.length,
  bpm_mae: mean(bpmErrors),
  section_boundary_median_ms: median(sectionErrors),
  moment_top1_recall: momentExpected ? momentTop1Hits / momentExpected : null,
  moment_top3_recall: momentExpected ? momentTop3Hits / momentExpected : null,
  social_top1_recall: socialExpected ? socialTop1Hits / socialExpected : null,
  social_top3_recall: socialExpected ? socialTop3Hits / socialExpected : null,
  top5_usable_recall: usableExpected ? usableHits / usableExpected : null,
  musical_completeness_mean: mean(completenessScores),
  moment_diversity_mean: mean(diversityScores),
  boundary_constrained_social_ratio: socialOptionCount ? boundaryConstrainedSocialCount / socialOptionCount : null,
};
const failures = evaluateThresholds(summary, manifest.thresholds);

console.log(JSON.stringify({ summary, failures, tracks }, null, 2));
if (failures.length) process.exitCode = 1;
