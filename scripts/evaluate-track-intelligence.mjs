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

function socialOptions(map, duration) {
  const options = map?.social_cut_options?.[String(duration)];
  if (Array.isArray(options) && options.length) return options;
  const primary = map?.social_cuts?.[String(duration)];
  return primary ? [primary] : [];
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
let momentExpected = 0;
let momentTop1Hits = 0;
let momentTop3Hits = 0;
let socialExpected = 0;
let socialTop1Hits = 0;
let socialTop3Hits = 0;
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
};
const failures = evaluateThresholds(summary, manifest.thresholds);

console.log(JSON.stringify({ summary, failures, tracks }, null, 2));
if (failures.length) process.exitCode = 1;
