"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { createServiceClient } from "@/lib/supabase/service";
import { loadVideoProjectContext, resolveProjectAudioUrl } from "@/lib/video-director/context";
import { fallbackMusicMap, mediaWorkerReadiness, queueMediaWorkerJob } from "@/lib/video-director/worker";
import { OpenAIMusicVideoDirector, openAIDirectorReadiness } from "@/lib/video-director/openai-director";
import { conceptFromRow, persistConceptRound, persistProductionPlan } from "@/lib/video-director/planner";
import {
  createApprovalEnvelope,
  prepareLookGenerationRecords,
  prepareShotGenerationRecords,
  refreshGeneration,
  submitApprovalEnvelope,
} from "@/lib/video-director/generation";
import { recordDirectorPreference } from "@/lib/video-director/preferences";
import { routeVideoShot } from "@/lib/video-director/model-router";
import { queueVideoRender, type VideoRenderType } from "@/lib/video-director/render";
import type { Json } from "@/types/database";
import type { ExtendedMusicVideoProject, VideoDatabase } from "@/types/video-database";
import type { SupabaseClient } from "@supabase/supabase-js";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function values(form: FormData, key: string) {
  return form.getAll(key).map(String).map((item) => item.trim()).filter(Boolean);
}

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function json(input: unknown): Json {
  return input as Json;
}

function refresh(projectId: string, releaseId?: string) {
  revalidatePath(`/studio/video/${projectId}`);
  if (releaseId) revalidatePath(`/studio/releases/${releaseId}`);
}

async function authenticatedProject(projectId: string) {
  const { user } = await requireStudioAdmin();
  const db = createServiceClient();
  const context = await loadVideoProjectContext(db, projectId, user.id);
  return { user, db, context };
}

async function projectById(
  db: SupabaseClient<VideoDatabase>,
  projectId: string,
  ownerId: string,
) {
  const { data, error } = await db.from("music_video_projects").select("*")
    .eq("id", projectId).eq("owner_id", ownerId).single();
  if (error || !data) throw new Error(error?.message || "Video project not found.");
  return data;
}

export async function analyzeMusicVideoTrack(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const { user, db, context } = await authenticatedProject(projectId);
  if (context.project.status === "archived") throw new Error("Archived projects are read only.");
  const audioUrl = await resolveProjectAudioUrl(db, context.project, user.id);
  const worker = mediaWorkerReadiness();
  if (worker.configured && audioUrl) {
    const { error } = await db.from("music_video_projects").update({
      status: "analyzing_audio",
      previous_status: null,
      last_error: null,
      analysis_requested_at: new Date().toISOString(),
    }).eq("id", projectId).eq("owner_id", user.id);
    if (error) throw new Error(error.message);
    await queueMediaWorkerJob({
      db,
      project: context.project,
      ownerId: user.id,
      jobType: "analyze_audio",
      payload: { audio_url: audioUrl },
      idempotencyKey: `analyze:${projectId}:${context.track.updated_at}`,
    });
  } else {
    if (!context.track.duration || context.track.duration <= 0) {
      throw new Error("Attach an audio source or set the track duration before using fallback analysis.");
    }
    const map = fallbackMusicMap(context.track.duration);
    const notes = record(context.project.director_notes);
    const { error } = await db.from("music_video_projects").update({
      music_map: json(map),
      status: "concept_review",
      previous_status: null,
      last_error: null,
      analysis_requested_at: new Date().toISOString(),
      analysis_completed_at: new Date().toISOString(),
      director_notes: json({
        ...notes,
        analysis_mode: "fallback",
        analysis_note: audioUrl
          ? "Media Worker is not configured. Structural timing is estimated until real analysis is available."
          : "No accessible audio URL was found. Structural timing is estimated from track duration.",
      }),
    }).eq("id", projectId).eq("owner_id", user.id);
    if (error) throw new Error(error.message);
  }
  refresh(projectId, context.release.id);
}

export async function useFallbackMusicAnalysis(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const { user, db, context } = await authenticatedProject(projectId);
  if (!context.track.duration || context.track.duration <= 0) throw new Error("Track duration is required for fallback analysis.");
  const notes = record(context.project.director_notes);
  const { error } = await db.from("music_video_projects").update({
    music_map: json(fallbackMusicMap(context.track.duration)),
    status: "concept_review",
    previous_status: null,
    last_error: null,
    analysis_completed_at: new Date().toISOString(),
    director_notes: json({ ...notes, analysis_mode: "fallback", analysis_note: "User chose estimated music structure." }),
  }).eq("id", projectId).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  refresh(projectId, context.release.id);
}

export async function generateVideoConcepts(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const { user, db, context } = await authenticatedProject(projectId);
  if (!context.musicMap) throw new Error("Analyze the music before generating concepts.");
  if (!openAIDirectorReadiness().configured) throw new Error("Creative Director is not configured. Set OPENAI_API_KEY.");
  const director = new OpenAIMusicVideoDirector();
  const concepts = await director.createConcepts(context);
  await persistConceptRound({ db, ownerId: user.id, project: context.project, concepts });
  refresh(projectId, context.release.id);
}

export async function selectVideoConcept(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const conceptId = z.uuid().parse(value(form, "concept_id"));
  const { user, db, context } = await authenticatedProject(projectId);
  const { data: concept, error } = await db.from("music_video_concepts").select("*")
    .eq("id", conceptId).eq("project_id", projectId).eq("owner_id", user.id).single();
  if (error || !concept) throw new Error(error?.message || "Concept not found.");
  await db.from("music_video_concepts").update({ status: "rejected" })
    .eq("project_id", projectId).eq("owner_id", user.id).eq("round_number", concept.round_number);
  await db.from("music_video_concepts").update({ status: "selected" }).eq("id", conceptId);
  await db.from("music_video_approvals").update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("project_id", projectId).eq("owner_id", user.id).eq("approval_type", "concept").eq("status", "active");
  const { error: approvalError } = await db.from("music_video_approvals").insert({
    owner_id: user.id,
    project_id: projectId,
    approval_type: "concept",
    scope: json({ concept_id: conceptId, round_number: concept.round_number }),
    max_credits: 0,
    consumed_credits: 0,
    reserved_credits: 0,
    status: "active",
    label: `Concept: ${concept.title}`,
  });
  if (approvalError) throw new Error(approvalError.message);
  const { error: projectError } = await db.from("music_video_projects").update({
    selected_concept_id: conceptId,
    status: "treatment_review",
    last_error: null,
  }).eq("id", projectId).eq("owner_id", user.id);
  if (projectError) throw new Error(projectError.message);
  refresh(projectId, context.release.id);
}

export async function generateVideoProductionPlan(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const { user, db, context } = await authenticatedProject(projectId);
  if (!context.project.selected_concept_id) throw new Error("Select a concept before building the production plan.");
  const { data: conceptRow, error } = await db.from("music_video_concepts").select("*")
    .eq("id", context.project.selected_concept_id).eq("project_id", projectId).eq("owner_id", user.id).single();
  if (error || !conceptRow) throw new Error(error?.message || "Selected concept not found.");
  const director = new OpenAIMusicVideoDirector();
  const concept = conceptFromRow(conceptRow.concept_data);
  const plan = await director.createProductionPlan(context, concept);
  const stored = await persistProductionPlan({ db, ownerId: user.id, context, plan });
  await db.from("music_video_concepts").update({
    treatment: `${concept.story}\n\n${stored.plan.editing_strategy}`,
  }).eq("id", conceptRow.id);
  refresh(projectId, context.release.id);
}

export async function approveVideoProductionPlan(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const { user, db, context } = await authenticatedProject(projectId);
  if (context.project.status !== "production_plan_review") throw new Error("This production plan is not waiting for approval.");
  await db.from("music_video_approvals").update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("project_id", projectId).eq("owner_id", user.id).eq("approval_type", "production_plan").eq("status", "active");
  const { error: approvalError } = await db.from("music_video_approvals").insert({
    owner_id: user.id,
    project_id: projectId,
    approval_type: "production_plan",
    scope: json({ selected_concept_id: context.project.selected_concept_id, estimated_credits: context.project.estimated_credits }),
    max_credits: 0,
    consumed_credits: 0,
    reserved_credits: 0,
    status: "active",
    label: "Approved production plan",
  });
  if (approvalError) throw new Error(approvalError.message);
  const { error } = await db.from("music_video_projects").update({ status: "look_dev", last_error: null })
    .eq("id", projectId).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  const project = await projectById(db, projectId, user.id);
  await prepareLookGenerationRecords({ db, ownerId: user.id, project });
  refresh(projectId, context.release.id);
}

async function plannedGenerationIds(
  db: SupabaseClient<VideoDatabase>,
  ownerId: string,
  projectId: string,
  operationType: "look_image" | "test_video" | "shot_video",
  limit?: number,
) {
  let query = db.from("music_video_generations").select("id")
    .eq("owner_id", ownerId).eq("project_id", projectId).eq("operation_type", operationType)
    .eq("status", "planned").is("approval_id", null).order("created_at");
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((item) => item.id);
}

export async function approveAndGenerateLookDevelopment(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const { user, db, context } = await authenticatedProject(projectId);
  if (context.project.status !== "look_dev") throw new Error("Look development is not ready for generation.");
  const ids = values(form, "generation_id");
  const generationIds = ids.length ? ids.map((id) => z.uuid().parse(id)) : await plannedGenerationIds(db, user.id, projectId, "look_image");
  const approval = await createApprovalEnvelope({ db, ownerId: user.id, project: context.project, generationIds, label: "Look development batch" });
  await submitApprovalEnvelope({ db, ownerId: user.id, approvalId: approval.id });
  refresh(projectId, context.release.id);
}

export async function approveLookReferences(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const assetIds = values(form, "asset_id").map((id) => z.uuid().parse(id));
  if (!assetIds.length) throw new Error("Select at least one approved look reference.");
  const { user, db, context } = await authenticatedProject(projectId);
  const { data: valid, error } = await db.from("music_video_generations").select("result_asset_id")
    .eq("owner_id", user.id).eq("project_id", projectId).eq("operation_type", "look_image")
    .eq("status", "completed").in("result_asset_id", assetIds);
  if (error) throw new Error(error.message);
  const validIds = new Set((valid ?? []).flatMap((item) => item.result_asset_id ? [item.result_asset_id] : []));
  if (assetIds.some((id) => !validIds.has(id))) throw new Error("One or more selected references are not completed look-development assets.");
  const notes = record(context.project.director_notes);
  const refs = assetIds.slice(0, 8);
  const { error: shotError } = await db.from("music_video_shots").update({
    reference_asset_ids: json(refs),
    status: "ready_for_generation",
  }).eq("project_id", projectId).eq("owner_id", user.id);
  if (shotError) throw new Error(shotError.message);
  const { error: projectError } = await db.from("music_video_projects").update({
    director_notes: json({ ...notes, approved_look_asset_ids: refs }),
    status: "test_generation",
    last_error: null,
  }).eq("id", projectId).eq("owner_id", user.id);
  if (projectError) throw new Error(projectError.message);
  const project = await projectById(db, projectId, user.id);
  await prepareShotGenerationRecords({ db, ownerId: user.id, project });
  refresh(projectId, context.release.id);
}

export async function approveAndGenerateTestShots(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const { user, db, context } = await authenticatedProject(projectId);
  if (context.project.status !== "test_generation") throw new Error("Test shots are not ready for generation.");
  const ids = values(form, "generation_id");
  const generationIds = ids.length ? ids.map((id) => z.uuid().parse(id)) : await plannedGenerationIds(db, user.id, projectId, "test_video");
  const approval = await createApprovalEnvelope({ db, ownerId: user.id, project: context.project, generationIds, label: "Representative test shots" });
  await submitApprovalEnvelope({ db, ownerId: user.id, approvalId: approval.id });
  refresh(projectId, context.release.id);
}

export async function approveTestShots(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const { user, db, context } = await authenticatedProject(projectId);
  const { data: generations, error } = await db.from("music_video_generations").select("shot_id")
    .eq("owner_id", user.id).eq("project_id", projectId).eq("operation_type", "test_video").eq("status", "completed");
  if (error) throw new Error(error.message);
  const shotIds = [...new Set((generations ?? []).flatMap((item) => item.shot_id ? [item.shot_id] : []))];
  if (!shotIds.length) throw new Error("Generate test shots before approving the visual language.");
  const { data: shots, error: shotError } = await db.from("music_video_shots").select("id,status")
    .eq("owner_id", user.id).in("id", shotIds);
  if (shotError) throw new Error(shotError.message);
  if ((shots ?? []).some((shot) => shot.status !== "locked")) throw new Error("Choose and lock a result for every test shot first.");
  const { error: projectError } = await db.from("music_video_projects").update({ status: "production", last_error: null })
    .eq("id", projectId).eq("owner_id", user.id);
  if (projectError) throw new Error(projectError.message);
  refresh(projectId, context.release.id);
}

export async function approveAndGenerateNextProductionBatch(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const batchSize = z.coerce.number().int().min(1).max(8).parse(value(form, "batch_size") || "4");
  const { user, db, context } = await authenticatedProject(projectId);
  if (!["production", "shot_review"].includes(context.project.status)) throw new Error("Production is not ready for another batch.");
  const chosen = values(form, "generation_id");
  const generationIds = chosen.length
    ? chosen.map((id) => z.uuid().parse(id))
    : await plannedGenerationIds(db, user.id, projectId, "shot_video", batchSize);
  if (!generationIds.length) throw new Error("No production shots are waiting for generation.");
  if (context.project.status === "shot_review") await db.from("music_video_projects").update({ status: "production" }).eq("id", projectId);
  const approval = await createApprovalEnvelope({ db, ownerId: user.id, project: context.project, generationIds, label: `Production batch of ${generationIds.length}` });
  await submitApprovalEnvelope({ db, ownerId: user.id, approvalId: approval.id });
  refresh(projectId, context.release.id);
}

export async function lockShotGeneration(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const generationId = z.uuid().parse(value(form, "generation_id"));
  const signal = value(form, "signal") || "Approved shot direction";
  const note = value(form, "note");
  const { user, db, context } = await authenticatedProject(projectId);
  const { data: generation, error } = await db.from("music_video_generations").select("*")
    .eq("id", generationId).eq("owner_id", user.id).eq("project_id", projectId).eq("status", "completed").single();
  if (error || !generation || !generation.shot_id || !generation.result_asset_id) throw new Error(error?.message || "Completed shot generation not found.");
  const { error: shotError } = await db.from("music_video_shots").update({
    selected_asset_id: generation.result_asset_id,
    status: "locked",
    locked_at: new Date().toISOString(),
    review_note: note || null,
  }).eq("id", generation.shot_id).eq("owner_id", user.id);
  if (shotError) throw new Error(shotError.message);
  await recordDirectorPreference({ db, ownerId: user.id, signal, positive: true, projectId, shotId: generation.shot_id, generationId, note });
  refresh(projectId, context.release.id);
}

export async function rejectShotGeneration(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const generationId = z.uuid().parse(value(form, "generation_id"));
  const signal = value(form, "signal") || "Rejected visual direction";
  const note = value(form, "note");
  const { user, db, context } = await authenticatedProject(projectId);
  const { data: generation, error } = await db.from("music_video_generations").select("*")
    .eq("id", generationId).eq("owner_id", user.id).eq("project_id", projectId).eq("status", "completed").single();
  if (error || !generation || !generation.shot_id) throw new Error(error?.message || "Completed shot generation not found.");
  await db.from("music_video_generations").update({
    provider_metadata: json({ ...record(generation.provider_metadata), review: "rejected", review_note: note || null }),
  }).eq("id", generationId);
  await db.from("music_video_shots").update({ status: "ready_for_generation", review_note: note || null }).eq("id", generation.shot_id);
  await recordDirectorPreference({ db, ownerId: user.id, signal, positive: false, projectId, shotId: generation.shot_id, generationId, note });
  refresh(projectId, context.release.id);
}

export async function requestShotAlternative(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const shotId = z.uuid().parse(value(form, "shot_id"));
  const { user, db, context } = await authenticatedProject(projectId);
  const { data: shot, error } = await db.from("music_video_shots").select("*")
    .eq("id", shotId).eq("project_id", projectId).eq("owner_id", user.id).single();
  if (error || !shot) throw new Error(error?.message || "Shot not found.");
  const { error: updateError } = await db.from("music_video_shots").update({
    prompt_version: shot.prompt_version + 1,
    status: "ready_for_generation",
    selected_asset_id: null,
    locked_at: null,
  }).eq("id", shot.id);
  if (updateError) throw new Error(updateError.message);
  const project = await projectById(db, projectId, user.id);
  await prepareShotGenerationRecords({ db, ownerId: user.id, project });
  refresh(projectId, context.release.id);
}

export async function reviseVideoShot(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const shotId = z.uuid().parse(value(form, "shot_id"));
  const instruction = z.string().trim().min(3).max(2000).parse(value(form, "instruction"));
  const { user, db, context } = await authenticatedProject(projectId);
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
    visualBible: context.project.visual_bible as never,
    currentShot: {
      start_ms: shot.start_ms,
      end_ms: shot.end_ms,
      description: shot.description,
      prompt: shot.prompt || "",
      negative_prompt: shot.negative_prompt || "",
      camera: typeof params.camera === "string" ? params.camera : "",
      transition_in: typeof params.transition_in === "string" ? params.transition_in : "cut",
      transition_out: typeof params.transition_out === "string" ? params.transition_out : "cut",
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
  const { error: updateError } = await db.from("music_video_shots").update({
    description: revised.description,
    prompt: revised.prompt,
    negative_prompt: revised.negative_prompt,
    capability_profile: json(revised.capability_profile),
    generation_priority: revised.generation_priority,
    reuse_strategy: revised.reuse_strategy,
    selected_model: routing.model,
    generation_params: json({ ...params, ...routing.params, camera: revised.camera, transition_in: revised.transition_in, transition_out: revised.transition_out, routing_reason: routing.reason }),
    prompt_version: shot.prompt_version + 1,
    status: "ready_for_generation",
    selected_asset_id: null,
    locked_at: null,
  }).eq("id", shot.id);
  if (updateError) throw new Error(updateError.message);
  const project = await projectById(db, projectId, user.id);
  await prepareShotGenerationRecords({ db, ownerId: user.id, project });
  refresh(projectId, context.release.id);
}

export async function refreshPendingVideoGenerations(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const { user, db, context } = await authenticatedProject(projectId);
  const { data: pending, error } = await db.from("music_video_generations").select("*")
    .eq("owner_id", user.id).eq("project_id", projectId)
    .in("status", ["queued", "in_progress", "submitted"]).not("provider_request_id", "is", null)
    .order("created_at").limit(8);
  if (error) throw new Error(error.message);
  for (const generation of pending ?? []) {
    try { await refreshGeneration({ db, generation }); } catch { /* keep remaining jobs refreshable */ }
  }
  refresh(projectId, context.release.id);
}

export async function finalizeVideoShotReview(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const { user, db, context } = await authenticatedProject(projectId);
  const { data: shots, error } = await db.from("music_video_shots").select("*")
    .eq("owner_id", user.id).eq("project_id", projectId).order("display_order");
  if (error) throw new Error(error.message);
  const required = (shots ?? []).filter((shot) => ["unique", "continuation"].includes(shot.reuse_strategy));
  const missing = required.filter((shot) => shot.status !== "locked" || !shot.selected_asset_id);
  if (missing.length) throw new Error(`${missing.length} generated source shot${missing.length === 1 ? " is" : "s are"} still waiting for a locked result.`);
  if ((shots ?? [])[0] && !(shots ?? [])[0].selected_asset_id) throw new Error("The first timeline shot must have its own locked source.");
  const { error: projectError } = await db.from("music_video_projects").update({ status: "ready_to_render", last_error: null })
    .eq("id", projectId).eq("owner_id", user.id);
  if (projectError) throw new Error(projectError.message);
  refresh(projectId, context.release.id);
}

export async function renderVideoOutput(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const type = z.enum(["master_16_9", "social_9_16", "promo_30", "hook_15"]).parse(value(form, "render_type")) as VideoRenderType;
  const allowUnsafeVertical = form.get("allow_unsafe_vertical") === "on";
  const { user, db, context } = await authenticatedProject(projectId);
  if (!mediaWorkerReadiness().configured) throw new Error("Media Worker is not configured. Rendering requires MEDIA_WORKER_URL and MEDIA_WORKER_SECRET.");
  if (type === "master_16_9" && context.project.status !== "ready_to_render") throw new Error("Finalize shot review before rendering the master.");
  const audioUrl = await resolveProjectAudioUrl(db, context.project, user.id);
  if (!audioUrl) throw new Error("A master or preview audio URL is required for final assembly.");
  await queueVideoRender({ db, ownerId: user.id, project: context.project, type, audioUrl, allowUnsafeVertical });
  refresh(projectId, context.release.id);
}

export async function revokeVideoApproval(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const approvalId = z.uuid().parse(value(form, "approval_id"));
  const { user, db, context } = await authenticatedProject(projectId);
  const { data: approval, error } = await db.from("music_video_approvals").select("*")
    .eq("id", approvalId).eq("project_id", projectId).eq("owner_id", user.id).single();
  if (error || !approval) throw new Error(error?.message || "Approval not found.");
  if (approval.reserved_credits > 0) throw new Error("An approval with active reserved generations cannot be revoked until those jobs settle.");
  const { error: updateError } = await db.from("music_video_approvals").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("id", approvalId);
  if (updateError) throw new Error(updateError.message);
  refresh(projectId, context.release.id);
}
