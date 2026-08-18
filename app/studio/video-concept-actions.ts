"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { createServiceClient } from "@/lib/supabase/service";
import { loadVideoProjectContext } from "@/lib/video-director/context";
import { OpenAIMusicVideoDirector, openAIDirectorReadiness } from "@/lib/video-director/openai-director";
import { conceptFromRow, persistConceptRound } from "@/lib/video-director/planner";
import type { Json } from "@/types/database";

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

export async function reviseSelectedVideoConcept(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const instruction = z.string().trim().min(3).max(1800).parse(value(form, "instruction"));
  const { user } = await requireStudioAdmin();
  if (!openAIDirectorReadiness().configured) throw new Error("Creative Director is not configured.");
  const db = createServiceClient();
  const context = await loadVideoProjectContext(db, projectId, user.id);
  if (context.project.status !== "treatment_review" || !context.project.selected_concept_id) {
    throw new Error("Choose a concept before asking for a revision or mix.");
  }

  const { data: selectedRow, error: selectedError } = await db.from("music_video_concepts")
    .select("*")
    .eq("id", context.project.selected_concept_id)
    .eq("project_id", projectId)
    .eq("owner_id", user.id)
    .single();
  if (selectedError || !selectedRow) throw new Error(selectedError?.message || "Selected concept not found.");
  const selected = conceptFromRow(selectedRow.concept_data);
  const currentBrief = record(context.project.creative_brief);
  const revisionNote = [
    typeof currentBrief.note === "string" ? currentBrief.note : "",
    "REVISION SOURCE - preserve only what remains useful from this approved direction:",
    JSON.stringify(selected),
    `USER REVISION / MIX REQUEST: ${instruction}`,
    "Return three materially different revisions that all clearly respond to this request. Do not merely rename the old concept.",
  ].filter(Boolean).join("\n\n");
  const revisionProject = {
    ...context.project,
    selected_concept_id: null,
    creative_brief: json({ ...currentBrief, note: revisionNote }),
  };
  const revisionContext = { ...context, project: revisionProject };
  const concepts = await new OpenAIMusicVideoDirector().createConcepts(revisionContext);

  const { error: oldConceptError } = await db.from("music_video_concepts")
    .update({ status: "superseded" })
    .eq("id", selectedRow.id)
    .eq("owner_id", user.id);
  if (oldConceptError) throw new Error(oldConceptError.message);
  const { error: revokeError } = await db.from("music_video_approvals").update({
    status: "revoked",
    revoked_at: new Date().toISOString(),
  }).eq("project_id", projectId).eq("owner_id", user.id).eq("approval_type", "concept").eq("status", "active");
  if (revokeError) throw new Error(revokeError.message);

  await persistConceptRound({
    db,
    ownerId: user.id,
    project: revisionProject,
    concepts,
  });
  const notes = record(context.project.director_notes);
  const { error: projectError } = await db.from("music_video_projects").update({
    selected_concept_id: null,
    status: "concept_review",
    last_error: null,
    director_notes: json({
      ...notes,
      last_concept_revision: {
        instruction,
        source_concept_id: selectedRow.id,
        source_concept_title: selected.title,
        requested_at: new Date().toISOString(),
      },
    }),
  }).eq("id", projectId).eq("owner_id", user.id);
  if (projectError) throw new Error(projectError.message);

  revalidatePath(`/studio/video/${projectId}`);
  revalidatePath(`/studio/releases/${context.release.id}`);
}
