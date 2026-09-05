#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const measurementsPath = argValue("--measurements");
const gatesPath = argValue("--gates") || "config/product-quality-gates.json";
const strict = process.argv.includes("--strict");

if (!measurementsPath) {
  console.error("Usage: node scripts/evaluate-product-quality.mjs --measurements <file.json> [--gates <file.json>] [--strict]");
  process.exit(2);
}

const [gatesDocument, measurementsDocument] = await Promise.all([
  readFile(gatesPath, "utf8").then(JSON.parse),
  readFile(measurementsPath, "utf8").then(JSON.parse),
]);

const gates = gatesDocument?.gates ?? {};
const measurements = measurementsDocument?.measurements ?? measurementsDocument ?? {};
const results = [];

for (const [id, gate] of Object.entries(gates)) {
  const measured = measurements[id];
  const numeric = typeof measured === "number" && Number.isFinite(measured);
  const direction = gate?.direction;
  const threshold = gate?.threshold;
  const validGate = (direction === "min" || direction === "max") && typeof threshold === "number" && Number.isFinite(threshold);

  if (!validGate) {
    results.push({ id, label: gate?.label ?? id, status: "invalid_gate", measured: measured ?? null, threshold: threshold ?? null, direction: direction ?? null });
    continue;
  }

  if (!numeric) {
    results.push({ id, label: gate?.label ?? id, status: "missing", measured: null, threshold, direction });
    continue;
  }

  const passed = direction === "min" ? measured >= threshold : measured <= threshold;
  results.push({ id, label: gate?.label ?? id, status: passed ? "pass" : "fail", measured, threshold, direction });
}

const counts = results.reduce((acc, result) => {
  acc[result.status] = (acc[result.status] ?? 0) + 1;
  return acc;
}, {});

for (const result of results) {
  const marker = result.status === "pass" ? "PASS" : result.status === "fail" ? "FAIL" : result.status.toUpperCase();
  const comparison = result.direction === "min" ? ">=" : result.direction === "max" ? "<=" : "?";
  const observed = result.measured === null ? "not measured" : String(result.measured);
  console.log(`${marker.padEnd(12)} ${result.label}: ${observed} ${comparison} ${result.threshold ?? "?"}`);
}

console.log(`\nSummary: ${counts.pass ?? 0} pass, ${counts.fail ?? 0} fail, ${counts.missing ?? 0} missing, ${counts.invalid_gate ?? 0} invalid gate.`);
console.log("These gates are review thresholds, not claims about current Ensemblis performance.");

if (strict && ((counts.fail ?? 0) > 0 || (counts.missing ?? 0) > 0 || (counts.invalid_gate ?? 0) > 0)) process.exit(1);
