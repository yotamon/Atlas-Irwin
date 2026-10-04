import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared action hierarchy enforces one dominant action and bounded secondary choices", async () => {
  const widgets = await source("components/studio/ux-v4-widgets.tsx");

  assert.match(widgets, /MAX_VISIBLE_SECONDARY_ACTIONS\s*=\s*2/);
  assert.match(widgets, /primaryActions\.length\s*>\s*1/);
  assert.match(widgets, /only one primary action/i);
});

test("Track default surface exposes state and ranked recommendation before technical detail", async () => {
  const track = await source("app/studio/(protected)/music/[id]/page.tsx");

  const state = track.indexOf("track-human-factors-state");
  const recommendation = track.indexOf("track-human-factors-recommendation");
  const actions = track.indexOf("track-human-factors-actions");
  const summary = track.indexOf("track-human-factors-summary");
  const technical = track.indexOf("Technical details");

  assert.ok(state >= 0, "Track needs one explicit current-state surface");
  assert.ok(recommendation > state, "ranked recommendation must follow current state");
  assert.ok(actions > recommendation, "secondary object actions must follow the recommendation");
  assert.ok(summary > actions, "music understanding summary must follow task actions");
  assert.ok(technical > summary, "technical detail must stay secondary");
});

test("advanced evidence uses the existing contextual disclosure system", async () => {
  const track = await source("app/studio/(protected)/music/[id]/page.tsx");
  const widgets = await source("components/studio/ux-v4-widgets.tsx");
  const inspector = await source("components/studio/context-inspector.tsx");

  assert.ok(track.includes("<ContextInspector"));
  assert.ok(widgets.includes("export function CompactEvidence"));
  assert.ok(inspector.includes('aria-haspopup="dialog"'));
});
