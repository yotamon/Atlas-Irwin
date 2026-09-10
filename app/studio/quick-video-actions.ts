"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { createServiceClient } from "@/lib/supabase/service";
import { loadVideoProjectContext } from "@/lib/video-director/context";
import { parseVideoCreativeBrief } from "@/lib/video-director/domain";
import { OpenAIMusicVideoDirector, openAIDirectorReadiness } from "@/lib/video-director/openai-director";
import { conceptFromRow, persistConceptRound, persistProductionPlan } from "@/lib/video-director/planner";
import type { Json } from "@/types/database";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function json(input: unknown): Json {
  return input as Json;
}

function refresh(projectId: string, releaseId: string) {
  revalidatePath(`/studio/video/${projectId}`);
  revalidatePath(`/studio/releases/${releaseId}`);
}

export async function developQuickVideoDirection(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const db = createServiceClient();
  let context = await loadVideoProjectContext(db, projectId, user.id, artist.artistId);
  const brief = parseVideoCreativeBrief(context.project.creative_brief);

  if (brief.workflow_mode !== "quick_video") throw new Error("This action is only available for Quick Video projects.");
  if (!context.musicMap) throw new Error("Analyze the track before developing the selected direction.");
  if (!openAIDirectorReadiness().configured) throw new Error("Creative Director is not configured.");
  if (!["concept_review", "treatment_review", "production_plan_review"].includes(context.project.status)) {
    throw new Error("Quick Video direction development is not available at this project stage.");
  }

  const director = new OpenAIMusicVideoDirector();
  if (context.project.status === "concept_review") {
    const concept = await director.createQuickVideoConcept(context);
    const rows = await persistConceptRound({ db, ownerId: user.id, project: context.project, concepts: [concept] });
    const selected = rows[0];
    if (!selected) throw new Error("Quick Video could not persist the developed direction.");

    const { error: conceptError } = await db.from("music_video_concepts")
      .update({ status: "selected" }).eq("id", selected.id).eq("owner_id", user.id);
    if (conceptError) throw new Error(conceptError.message);

    await db.from("music_video_approvals").update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("project_id", projectId).eq("owner_id", user.id).eq("approval_type", "concept").eq("status", "active");

    const { error: approvalError } = await db.from("music_video_approvals").insert({
      owner_id: user.id,
      project_id: projectId,
      approval_type: "concept",
      scope: json({
        concept_id: selected.id,
        round_number: selected.round_number,
        workflow_mode: "quick_video",
        quick_video_direction_id: brief.concept_id,
        anchor_moment_id: brief.anchor_moment_id,
      }),
      max_credits: 0,
      consumed_credits: 0,
      reserved_credits: 0,
      status: "active",
      label: `Quick Video direction: ${selected.title}`,
    });
    if (approvalError) throw new Error(approvalError.message);

    const { error: projectError } = await db.from("music_video_projects").update({
      selected_concept_id: selected.id,
      status: "treatment_review",
      last_error: null,
    }).eq("id", projectId).eq("owner_id", user.id);
    if (projectError) throw new Error(projectError.message);

    context = await loadVideoProjectContext(db, projectId, user.id, artist.artistId);
  }

  if (context.project.status === "treatment_review") {
    if (!context.project.selected_concept_id) throw new Error("Quick Video has no developed concept to plan.");
    const { data: conceptRow, error: conceptError } = await db.from("music_video_concepts").select("*")
      .eq("id", context.project.selected_concept_id)
      .eq("project_id", projectId)
      .eq("owner_id", user.id)
      .single();
    if (conceptError || !conceptRow) throw new Error(conceptError?.message ?? "Quick Video concept not found.");

    const concept = conceptFromRow(conceptRow.concept_data);
    const plan = await director.createProductionPlan(context, concept);
    const stored = await persistProductionPlan({ db, ownerId: user.id, context, plan });
    const { error: treatmentError } = await db.from("music_video_concepts").update({
      treatment: `${concept.story}\n\n${stored.plan.editing_strategy}`,
    }).eq("id", conceptRow.id).eq("owner_id", user.id);
    if (treatmentError) throw new Error(treatmentError.message);
  }

  refresh(projectId, context.release.id);
}
