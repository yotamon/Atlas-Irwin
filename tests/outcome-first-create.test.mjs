import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Create recommends three musically grounded directions instead of a Moment by outcome matrix", async () => {
  const create = await source("app/studio/(protected)/create/page.tsx");
  for (const snippet of [
    "three strongest creative directions",
    "recommendCreativeDirections",
    "curateReleaseMoments",
    "Create this direction",
    "Review source Moments",
    "startOutcomeCreative",
    "Other starting points",
  ]) assert.ok(create.includes(snippet), `Create must retain ${snippet}`);
  assert.ok(create.includes("<form action={startOutcomeCreative}"));
  assert.equal(create.includes("CREATE_OUTCOMES.map"), false, "default Create must not render every outcome for every Moment");
  assert.equal(create.includes('href={href(`/studio/production?release=${moment.release_id}&moment=${moment.id}`)}'), false);
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

test("creative direction cards remain usable on desktop and mobile", async () => {
  const create = await source("app/studio/(protected)/create/page.tsx");
  const css = await source("app/studio/create-polish.css");
  assert.ok(create.includes("create-moment-grid"));
  assert.ok(create.includes("create-moment-card"));
  assert.ok(create.includes('className="button primary"'));
  assert.ok(css.includes("@media (max-width: 720px)"));
  assert.ok(css.includes("grid-template-columns: 1fr"));
});
