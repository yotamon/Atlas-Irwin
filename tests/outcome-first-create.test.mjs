import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Create recommends three deliverables grounded in the strongest musical Moments", async () => {
  const create = await source("app/studio/(protected)/create/page.tsx");
  for (const snippet of [
    "What do you want to make?",
    "Three strong options",
    "recommendCreativeDirections",
    "curateReleaseMoments",
    "Create {direction.outcome.format}",
    "Review source Moments",
    "startOutcomeCreative",
    "Other ways to create",
    "Ensemblis picked",
  ]) assert.ok(create.includes(snippet), `Create must retain ${snippet}`);
  assert.ok(create.includes("<form action={startOutcomeCreative}"));
  assert.equal(create.includes("CREATE_OUTCOMES.map"), false, "default Create must not render every outcome for every Moment");
  assert.equal(create.includes('href={href(`/studio/production?release=${moment.release_id}&moment=${moment.id}`)}'), false);
});

test("an explicitly selected Best Moment remains the exact creative source", async () => {
  const [create, moments] = await Promise.all([
    source("app/studio/(protected)/create/page.tsx"),
    source("components/studio/moment-review-panel.tsx"),
  ]);
  assert.ok(create.includes("moment?: string"));
  assert.ok(create.includes("const requestedMoment = params.moment"));
  assert.ok(create.includes("requestedMoment ? [requestedMoment]"));
  assert.ok(create.includes("Your selected Moment"));
  assert.ok(moments.includes('href={`/studio/create?release=${releaseId}&moment=${moment.id}`}'));
  assert.equal(moments.includes("&track=${moment.track_id}"), false, "Create from this Moment must not fall back to a track-level re-selection");
});

test("creative direction ranking is bounded, active-release aware and keeps outcome diversity", async () => {
  const directions = await source("lib/studio/creative-directions.ts");
  for (const phrase of [
    "CREATIVE_DIRECTION_MAX_RESULTS = 3",
    "activeReleaseMoments",
    "usedOutcomes",
    "usedMoments",
    "outcomeScore",
    'outcomeId === "reach"',
    'outcomeId === "streams"',
    'outcomeId === "lyric"',
    "recommendCreativeDirections",
  ]) assert.ok(directions.includes(phrase), `creative direction engine must retain ${phrase}`);
});

test("creative outcome catalog maps human goals to deterministic delivery defaults", async () => {
  const outcomes = await source("lib/studio/create-outcomes.ts");
  for (const phrase of [
    "Get heard",
    "Drive streams",
    "Make the lyric stick",
    "Build recognition",
    'goal: "Reach"',
    'goal: "Streams"',
    'format: "Mood video"',
    "resolveCreateOutcome",
  ]) assert.ok(outcomes.includes(phrase), `outcome catalog must retain ${phrase}`);
});

test("outcome click validates artist and approved Moment before creating production work", async () => {
  const action = await source("app/studio/create-actions.ts");
  for (const snippet of [
    "resolveArtistContext",
    'from("moments")',
    '.eq("owner_id", artist.userId)',
    '.eq("artist_id", artist.artistId)',
    'moment.state !== "approved"',
    'production.set("release_id", moment.release_id)',
    'production.set("moment_id", moment.id)',
    'production.set("platform", outcome.platform)',
    'production.set("format", outcome.format)',
    'production.set("goal", outcome.goal)',
    'production.set("audio_timestamp_start"',
    'production.set("audio_timestamp_end"',
    "await saveContentV2(production)",
  ]) assert.ok(action.includes(snippet), `outcome action must retain ${snippet}`);
});

test("deliverable cards remain usable on desktop and collapse to one column on smaller screens", async () => {
  const create = await source("app/studio/(protected)/create/page.tsx");
  const css = await source("app/studio/design-system/workflows.css");
  assert.ok(create.includes("create-deliverable-grid"));
  assert.ok(create.includes("create-deliverable-card"));
  assert.ok(create.includes('className="button primary"'));
  assert.ok(css.includes("@media (max-width: 960px)"));
  assert.ok(css.includes(".studio-root .create-deliverable-grid"));
  assert.ok(css.includes("grid-template-columns: 1fr"));
});
