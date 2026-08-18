"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { createServiceClient } from "@/lib/supabase/service";
import { loadVideoProjectContext } from "@/lib/video-director/context";
import { OpenAIMusicVideoDirector } from "@/lib/video-director/openai-director";
import { conceptFromRow } from "@/lib/video-director/planner";
import { routeVideoShot } from "@/lib/video-director/model-router";
import { prepareShotGenerationRecords } from "@/lib/video-director/generation";
import type { Json } from "@/types/database";
import type { VisualBible } from "@/lib/video-director/creative-director";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function json(input: unknown): Json {
  return input as Json;
}

export async function reviseVideoShotWithFraming(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const shotId = z.uuid().parse(value(form, "shot_id"));
  const instruction = z.string().trim().min(3).max(2000).parse(value(form, "instruction"));
  const { user } = await requireStudioAdmin();
  const db = createServiceClient();
  const context = await loadVideoProjectContext(db, projectId, user.id);
  if (!context.project.selected_concept_id) throw new Error("Project has no selected concept.");

  const [{ data: shot, error: shotError }, { data: conceptRow, error: conceptError }] = await Promise.all([
    db.from("music_video_shots").select("*").eq("id", shotId).eq("project_id", projectId).eq("owner_id", user.id).single(),
    db.from("music_video_concepts").select("*").eq("id", context.project.selected_concept_id).eq("owner_id", user.id).single(),
  ]);
  if (shotError || !shot) throw new Error(shotError?.message || "Shot not found.");
  if (conceptError || !conceptRow) throw new Error(conceptError?.message || "Concept not found.");

  const params = record(shot.generation_params);
  const director = new OpenAIMusicVideoDirector();
  const revised = await director.reviseShot({
    context,
    concept: conceptFromRow(conceptRow.concept_data),
    visualBible: context.project.visual_bible as unknown as VisualBible,
    currentShot: {
      start_ms: shot.start_ms,
      end_ms: shot.end_ms,
      description: shot.description,
      prompt: shot.prompt || "",
      negative_prompt: shot.negative_prompt || "",
      camera: typeof params.camera === "string" ? params.camera : "",
      transition_in: typeof params.transition_in === "string" ? params.transition_in : "cut",
      transition_out: typeof params.transition_out === "string" ? params.transition_out : "cut",
      vertical_safe: typeof params.vertical_safe === "boolean" ? params.vertical_safe : undefined,
      vertical_focus: params.vertical_focus === "left" || params.vertical_focus === "right" || params.vertical_focus === "center" ? params.vertical_focus : undefined,
      generation_priority: shot.generation_priority,
      reuse_strategy: shot.reuse_strategy,
      capability_profile: shot.capability_profile as never,
    },
    instruction,
  });

  const routing = routeVideoShot({
    generation_priority: revised.generation_priority,
    capability_profile: json(revised.capability_profile),
    start_asset_id: shot.start_asset_id,
    end_asset_id: shot.end_asset_id,
    reference_asset_ids: shot.reference_asset_ids,
    music_context: shot.music_context,
    targetResolution: context.project.target_resolution,
  });
  const duration = typeof params.duration === "number" ? params.duration : Math.max(4, Math.ceil((shot.end_ms - shot.start_ms) / 1000));
  const { error: updateError } = await db.from("music_video_shots").update({
    description: revised.description,
    prompt: revised.prompt,
    negative_prompt: revised.negative_prompt,
    capability_profile: json(revised.capability_profile),
    generation_priority: revised.generation_priority,
    reuse_strategy: revised.reuse_strategy,
    selected_model: routing.model,
    generation_params: json({
      ...params,
      ...routing.params,
      duration,
      camera: revised.camera,
      transition_in: revised.transition_in,
      transition_out: revised.transition_out,
      vertical_safe: revised.vertical_safe,
      vertical_focus: revised.vertical_focus,
      routing_reason: routing.reason,
    }),
    prompt_version: shot.prompt_version + 1,
    status: "ready_for_generation",
    selected_asset_id: null,
    locked_at: null,
  }).eq("id", shot.id).eq("owner_id", user.id);
  if (updateError) throw new Error(updateError.message);

  const { data: project, error: projectError } = await db.from("music_video_projects").select("*").eq("id", projectId).eq("owner_id", user.id).single();
  if (projectError || !project) throw new Error(projectError?.message || "Project not found after shot revision.");
  await prepareShotGenerationRecords({ db, ownerId: user.id, project });
  revalidatePath(`/studio/video/${projectId}`);
  revalidatePath(`/studio/releases/${context.release.id}`);
}
