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
  const domain = await read("lib/video-director/domain.ts");

  assert.ok(actions.includes("quickVideoConceptSchema"));
  assert.ok(actions.includes('workflow_mode: "quick_video"'));
  assert.ok(actions.includes("concept_id: parsed.quick_video_concept"));
  assert.ok(actions.includes("concept_snapshot"));
  assert.ok(actions.includes("buildQuickVideoConcepts"));
  assert.ok(actions.includes("hard_budget_credits: parsed.hard_budget_credits"));
  assert.ok(actions.includes("The hard budget cannot be lower than spent and reserved credits."));

  assert.ok(domain.includes('workflow_mode: "quick_video" | "director_pro"'));
  assert.ok(domain.includes("concept_snapshot"));
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
  assert.ok(actions.includes('.eq("state", "approved")'));
  assert.ok(actions.includes("The selected track must belong to this release."));
});

test("Quick Video develops the already-selected direction instead of asking for another concept round", async () => {
  const director = await read("lib/video-director/openai-director.ts");
  const actions = await read("app/studio/quick-video-actions.ts");

  assert.ok(director.includes("createQuickVideoConcept"));
  assert.ok(director.includes("The artist has already chosen the creative direction"));
  assert.ok(director.includes("Do not propose alternatives"));
  assert.ok(actions.includes("director.createQuickVideoConcept(context)"));
  assert.ok(actions.includes("concepts: [concept]"));
  assert.ok(actions.includes('status: "selected"'));
  assert.ok(actions.includes("director.createProductionPlan(context, concept)"));
  assert.ok(actions.includes("persistProductionPlan"));
});

test("Quick Video project mode is outcome-first while Director Pro remains available", async () => {
  const page = await read("app/studio/(protected)/video/[id]/page.tsx");
  const workspace = await read("components/studio/video-director/project-workspace.tsx");
  const quickWorkspace = await read("components/studio/video-director/quick-video-project-workspace.tsx");

  assert.ok(page.includes('mode={mode === "pro" ? "pro" : "default"}'));
  assert.ok(workspace.includes('brief.workflow_mode === "quick_video" && mode !== "pro"'));
  assert.ok(workspace.includes("QuickVideoProjectWorkspace"));
  assert.ok(workspace.includes("Back to Quick Video"));

  assert.ok(quickWorkspace.includes("Four outcomes, one production engine"));
  assert.ok(quickWorkspace.includes("Representative preview"));
  assert.ok(quickWorkspace.includes("Master + socials"));
  assert.ok(quickWorkspace.includes("Open Director Pro"));
  assert.ok(quickWorkspace.includes("This step creates the treatment, visual system, storyboard and cost plan. It spends 0 generation credits."));
  assert.ok(quickWorkspace.includes("The next screen shows the exact preview-generation spend before anything is submitted."));
});
