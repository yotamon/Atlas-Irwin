"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_PEOPLE_MODES,
  VIDEO_PROJECT_KINDS,
  VIDEO_PROJECT_STATUSES,
  VIDEO_RESOLUTIONS,
  VIDEO_STORY_MODES,
  type VideoProjectStatus,
} from "@/lib/video-director/domain";
import { assertProjectTransition } from "@/lib/video-director/state";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

const projectKindSchema = z.enum(VIDEO_PROJECT_KINDS);
const aspectRatioSchema = z.enum(VIDEO_ASPECT_RATIOS);
const resolutionSchema = z.enum(VIDEO_RESOLUTIONS);
const storyModeSchema = z.enum(VIDEO_STORY_MODES);
const peopleModeSchema = z.enum(VIDEO_PEOPLE_MODES);
const projectStatusSchema = z.enum(VIDEO_PROJECT_STATUSES);
const titleSchema = z.string().trim().min(1).max(160);
const noteSchema = z.string().trim().max(4000);
const budgetSchema = z.coerce.number().finite().min(0).max(100000);

function projectPath(projectId: string) {
  return `/studio/video/${projectId}`;
}

export async function createMusicVideoProject(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const parsed = z.object({
    release_id: z.uuid(),
    track_id: z.uuid(),
    title: titleSchema,
    project_kind: projectKindSchema,
    primary_aspect_ratio: aspectRatioSchema,
    target_resolution: resolutionSchema,
    hard_budget_credits: budgetSchema,
    creative_note: noteSchema,
    story_mode: storyModeSchema,
    people_mode: peopleModeSchema,
  }).parse({
    release_id: value(form, "release_id"),
    track_id: value(form, "track_id"),
    title: value(form, "title"),
    project_kind: value(form, "project_kind"),
    primary_aspect_ratio: value(form, "primary_aspect_ratio"),
    target_resolution: value(form, "target_resolution"),
    hard_budget_credits: value(form, "hard_budget_credits"),
    creative_note: value(form, "creative_note"),
    story_mode: value(form, "story_mode"),
    people_mode: value(form, "people_mode"),
  });

  const [{ data: release, error: releaseError }, { data: track, error: trackError }] = await Promise.all([
    supabase.from("releases").select("id,owner_id,title").eq("id", parsed.release_id).single(),
    supabase.from("tracks").select("id,owner_id,release_id,title").eq("id", parsed.track_id).single(),
  ]);
  if (releaseError || !release) throw new Error(releaseError?.message ?? "Release not found.");
  if (trackError || !track) throw new Error(trackError?.message ?? "Track not found.");
  if (release.owner_id !== user.id || track.owner_id !== user.id || track.release_id !== release.id) {
    throw new Error("The selected track must belong to this release.");
  }

  const creative_brief = {
    note: parsed.creative_note,
    story_mode: parsed.story_mode,
    people_mode: parsed.people_mode,
    target: parsed.project_kind,
  };

  const { data, error } = await supabase
    .from("music_video_projects")
    .insert({
      owner_id: user.id,
      release_id: release.id,
      track_id: track.id,
      title: parsed.title,
      status: "draft",
      project_kind: parsed.project_kind,
      primary_aspect_ratio: parsed.primary_aspect_ratio,
      target_resolution: parsed.target_resolution,
      creative_brief,
      hard_budget_credits: parsed.hard_budget_credits,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath(`/studio/releases/${release.id}`);
  redirect(projectPath(data.id));
}

export async function updateMusicVideoProjectBrief(form: FormData) {
  const { supabase } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const parsed = z.object({
    title: titleSchema,
    primary_aspect_ratio: aspectRatioSchema,
    target_resolution: resolutionSchema,
    hard_budget_credits: budgetSchema,
    creative_note: noteSchema,
    story_mode: storyModeSchema,
    people_mode: peopleModeSchema,
  }).parse({
    title: value(form, "title"),
    primary_aspect_ratio: value(form, "primary_aspect_ratio"),
    target_resolution: value(form, "target_resolution"),
    hard_budget_credits: value(form, "hard_budget_credits"),
    creative_note: value(form, "creative_note"),
    story_mode: value(form, "story_mode"),
    people_mode: value(form, "people_mode"),
  });

  const { data: project, error: projectError } = await supabase
    .from("music_video_projects")
    .select("*")
    .eq("id", id)
    .single();
  if (projectError || !project) throw new Error(projectError?.message ?? "Video project not found.");
  if (project.status === "archived") throw new Error("Archived video projects cannot be edited.");

  if (project.spent_credits > 0 && parsed.hard_budget_credits !== project.hard_budget_credits) {
    throw new Error("The hard budget cannot be changed after credits have been spent.");
  }
  if (parsed.hard_budget_credits < project.spent_credits + project.reserved_credits) {
    throw new Error("The hard budget cannot be lower than spent and reserved credits.");
  }

  const creative_brief = {
    note: parsed.creative_note,
    story_mode: parsed.story_mode,
    people_mode: parsed.people_mode,
    target: project.project_kind,
  };

  const { error } = await supabase
    .from("music_video_projects")
    .update({
      title: parsed.title,
      primary_aspect_ratio: parsed.primary_aspect_ratio,
      target_resolution: parsed.target_resolution,
      hard_budget_credits: parsed.hard_budget_credits,
      creative_brief,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(projectPath(id));
  revalidatePath(`/studio/releases/${project.release_id}`);
}

export async function transitionMusicVideoProject(form: FormData) {
  const { supabase } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const target = projectStatusSchema.parse(value(form, "status"));

  const { data: project, error: projectError } = await supabase
    .from("music_video_projects")
    .select("id,release_id,status")
    .eq("id", id)
    .single();
  if (projectError || !project) throw new Error(projectError?.message ?? "Video project not found.");

  assertProjectTransition(project.status as VideoProjectStatus, target);
  const { error } = await supabase
    .from("music_video_projects")
    .update({ status: target })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(projectPath(id));
  revalidatePath(`/studio/releases/${project.release_id}`);
}

export async function archiveMusicVideoProject(form: FormData) {
  const next = new FormData();
  next.set("id", z.uuid().parse(value(form, "id")));
  next.set("status", "archived");
  await transitionMusicVideoProject(next);
}
