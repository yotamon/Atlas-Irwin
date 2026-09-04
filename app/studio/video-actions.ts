"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { recordCreativeMemoryEvent } from "@/lib/creative-memory/server";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asMomentsClient } from "@/lib/studio/moments-db";
import { buildQuickVideoConcepts, QUICK_VIDEO_CONCEPT_IDS } from "@/lib/video-director/quick-video";
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
const quickVideoConceptSchema = z.enum(QUICK_VIDEO_CONCEPT_IDS);
const projectStatusSchema = z.enum(VIDEO_PROJECT_STATUSES);
const titleSchema = z.string().trim().min(1).max(160);
const noteSchema = z.string().trim().max(4000);
const budgetSchema = z.coerce.number().finite().min(0).max(100000);

function projectPath(projectId: string) {
  return `/studio/video/${projectId}`;
}

async function requireProjectForActiveArtist(id: string) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const music = asArtistScopedMusicClient(supabase);
  const { data: project, error } = await supabase.from("music_video_projects")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error || !project) throw new Error(error?.message ?? "Video project not found.");
  const { data: release, error: releaseError } = await music.from("releases")
    .select("id")
    .eq("id", project.release_id)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (releaseError || !release) throw new Error(releaseError?.message ?? "Video project does not belong to the active artist.");
  return { supabase, user, artist, project };
}

export async function createMusicVideoProject(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const music = asArtistScopedMusicClient(supabase);
  const momentsDb = asMomentsClient(supabase);
  const parsed = z.object({
    release_id: z.uuid(),
    track_id: z.uuid(),
    title: titleSchema,
    quick_video_concept: quickVideoConceptSchema,
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
    quick_video_concept: value(form, "quick_video_concept"),
    project_kind: value(form, "project_kind"),
    primary_aspect_ratio: value(form, "primary_aspect_ratio"),
    target_resolution: value(form, "target_resolution"),
    hard_budget_credits: value(form, "hard_budget_credits"),
    creative_note: value(form, "creative_note"),
    story_mode: value(form, "story_mode"),
    people_mode: value(form, "people_mode"),
  });

  const [releaseResult, trackResult, momentsResult] = await Promise.all([
    music
      .from("releases")
      .select("id,owner_id,artist_id,title,story,core_emotion,primary_hook,visual_direction")
      .eq("id", parsed.release_id)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .single(),
    music
      .from("tracks")
      .select("id,owner_id,artist_id,release_id,title,notes")
      .eq("id", parsed.track_id)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .single(),
    momentsDb
      .from("moments")
      .select("id,track_id,label,moment_type,start_ms,end_ms,hook_score,energy_score,confidence")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("release_id", parsed.release_id)
      .eq("track_id", parsed.track_id)
      .eq("state", "approved")
      .order("confidence", { ascending: false })
      .limit(5),
  ]);
  const { data: release, error: releaseError } = releaseResult;
  const { data: track, error: trackError } = trackResult;
  if (releaseError || !release) throw new Error(releaseError?.message ?? "Release not found for the active artist.");
  if (trackError || !track) throw new Error(trackError?.message ?? "Track not found for the active artist.");
  if (momentsResult.error) throw new Error(momentsResult.error.message);
  if (track.release_id !== release.id) throw new Error("The selected track must belong to this release.");

  const selectedDirection = buildQuickVideoConcepts({
    release,
    track,
    moments: momentsResult.data ?? [],
  }).find((concept) => concept.id === parsed.quick_video_concept);
  if (!selectedDirection) throw new Error("Quick Video direction could not be resolved.");

  const creative_brief = {
    workflow_mode: "quick_video",
    concept_id: parsed.quick_video_concept,
    anchor_moment_id: selectedDirection.anchorMomentId,
    concept_snapshot: {
      title: selectedDirection.title,
      description: selectedDirection.description,
      rationale: selectedDirection.rationale,
    },
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
  if (error || !data) throw new Error(error?.message ?? "Could not create Quick Video project.");

  await recordCreativeMemoryEvent({
    db: supabase,
    ownerId: user.id,
    artistId: artist.artistId,
    eventType: "direction_selected",
    sentiment: 1,
    weight: 4,
    signal: `Selected Quick Video direction: ${selectedDirection.title}`,
    source: "quick_video",
    releaseId: release.id,
    trackId: track.id,
    momentId: selectedDirection.anchorMomentId,
    videoProjectId: data.id,
    idempotencyKey: `quick-video-direction:${data.id}:${selectedDirection.id}`,
    context: {
      direction_id: selectedDirection.id,
      title: selectedDirection.title,
      rationale: selectedDirection.rationale,
      anchor_moment_label: selectedDirection.anchorMomentLabel,
    },
  });

  revalidatePath(`/studio/releases/${release.id}`);
  redirect(projectPath(data.id));
}

export async function updateMusicVideoProjectBrief(form: FormData) {
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
  const { supabase, project } = await requireProjectForActiveArtist(id);
  if (project.status === "archived") throw new Error("Archived video projects cannot be edited.");
  if (project.spent_credits > 0 && parsed.hard_budget_credits !== project.hard_budget_credits) {
    throw new Error("The hard budget cannot be changed after credits have been spent.");
  }
  if (parsed.hard_budget_credits < project.spent_credits + project.reserved_credits) {
    throw new Error("The hard budget cannot be lower than spent and reserved credits.");
  }

  const currentBrief = project.creative_brief && typeof project.creative_brief === "object" && !Array.isArray(project.creative_brief)
    ? project.creative_brief
    : {};
  const creative_brief = {
    ...currentBrief,
    note: parsed.creative_note,
    story_mode: parsed.story_mode,
    people_mode: parsed.people_mode,
    target: project.project_kind,
  };
  const { error } = await supabase.from("music_video_projects")
    .update({
      title: parsed.title,
      primary_aspect_ratio: parsed.primary_aspect_ratio,
      target_resolution: parsed.target_resolution,
      hard_budget_credits: parsed.hard_budget_credits,
      creative_brief,
    })
    .eq("id", id)
    .eq("owner_id", project.owner_id);
  if (error) throw new Error(error.message);
  revalidatePath(projectPath(id));
  revalidatePath(`/studio/releases/${project.release_id}`);
}

export async function transitionMusicVideoProject(form: FormData) {
  const id = z.uuid().parse(value(form, "id"));
  const target = projectStatusSchema.parse(value(form, "status"));
  const { supabase, project } = await requireProjectForActiveArtist(id);
  assertProjectTransition(project.status as VideoProjectStatus, target);
  const { error } = await supabase.from("music_video_projects")
    .update({ status: target })
    .eq("id", id)
    .eq("owner_id", project.owner_id);
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
