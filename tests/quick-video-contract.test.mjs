import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("Quick Video offers exactly three music-aware default directions", async () => {
  const domain = await read("lib/video-director/quick-video.ts");
  const form = await read("components/studio/video-director/create-project-form.tsx");

  assert.ok(domain.includes('"hook_world"'));
  assert.ok(domain.includes('"performance_pulse"'));
  assert.ok(domain.includes('"narrative_reveal"'));
  assert.ok(domain.includes("strongestMoment(track, moments)"));
  assert.ok(domain.includes("release.primary_hook"));
  assert.ok(domain.includes("release.visual_direction"));

  assert.ok(form.includes("Quick Video · 1 of 3"));
  assert.ok(form.includes('role="radiogroup"'));
  assert.ok(form.includes('name="quick_video_concept"'));
  assert.ok(form.includes("Director Pro settings"));
  assert.ok(form.includes("Total generation budget"));
  assert.ok(form.includes("Creating the plan is free"));
});

test("Quick Video keeps concept lineage and the existing hard budget gate", async () => {
  const actions = await read("app/studio/video-actions.ts");

  assert.ok(actions.includes("quickVideoConceptSchema"));
  assert.ok(actions.includes('workflow_mode: "quick_video"'));
  assert.ok(actions.includes("concept_id: parsed.quick_video_concept"));
  assert.ok(actions.includes("hard_budget_credits: parsed.hard_budget_credits"));
  assert.ok(actions.includes("The hard budget cannot be lower than spent and reserved credits."));
});

test("Video default path is scoped to the active artist and only uses approved Moments", async () => {
  const page = await read("app/studio/(protected)/video/page.tsx");
  const actions = await read("app/studio/video-actions.ts");

  assert.ok(page.includes("requireArtistContext()"));
  assert.ok(page.includes('.eq("artist_id", artist.artistId)'));
  assert.ok(page.includes('.eq("state", "approved")'));
  assert.ok(page.includes("selectedMoments"));
  assert.ok(page.includes('title="Video"'));

  assert.ok(actions.includes("resolveActiveArtistContext(supabase, user)"));
  assert.ok(actions.includes('.eq("artist_id", artist.artistId)'));
  assert.ok(actions.includes("The selected track must belong to this release."));
});
