"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { recordCreativeMemoryEvent, upsertCreativeAssetProfile } from "@/lib/creative-memory/server";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { createServiceClient } from "@/lib/supabase/service";
import { parseVideoCreativeBrief } from "@/lib/video-director/domain";
import { prepareShotGenerationRecords } from "@/lib/video-director/generation";
import type { Json } from "@/types/database";

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

export async function approveCreativeMemoryLookReferences(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const assetIds = values(form, "asset_id").map((id) => z.uuid().parse(id));
  if (!assetIds.length) throw new Error("Select at least one approved look reference.");

  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const db = createServiceClient();
  const music = asArtistScopedMusicClient(db);
  const { data: project, error: projectError } = await db.from("music_video_projects")
    .select("*").eq("id", projectId).eq("owner_id", user.id).single();
  if (projectError || !project) throw new Error(projectError?.message || "Video project not found.");
  if (project.status !== "look_review") throw new Error("Visual language can only be approved during look review.");

  const [{ data: release, error: releaseError }, { data: track, error: trackError }] = await Promise.all([
    music.from("releases").select("id,artist_id")
      .eq("id", project.release_id).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    music.from("tracks").select("id,release_id,artist_id")
      .eq("id", project.track_id).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
  ]);
  if (releaseError || !release) throw new Error(releaseError?.message || "Video project does not belong to the active artist.");
  if (trackError || !track || track.release_id !== release.id) throw new Error(trackError?.message || "Video track does not belong to the active artist release.");

  const { data: generations, error: generationError } = await db.from("music_video_generations")
    .select("result_asset_id,request_payload")
    .eq("owner_id", user.id)
    .eq("project_id", projectId)
    .eq("operation_type", "look_image")
    .eq("status", "completed")
    .in("result_asset_id", assetIds);
  if (generationError) throw new Error(generationError.message);
  const validByAsset = new Map((generations ?? []).flatMap((generation) =>
    generation.result_asset_id ? [[generation.result_asset_id, generation] as const] : [],
  ));
  if (assetIds.some((id) => !validByAsset.has(id))) {
    throw new Error("One or more selected references are not completed look-development assets.");
  }

  const refs = assetIds.slice(0, 8);
  const { error: shotError } = await db.from("music_video_shots").update({
    reference_asset_ids: json(refs),
    status: "ready_for_generation",
  }).eq("project_id", projectId).eq("owner_id", user.id);
  if (shotError) throw new Error(shotError.message);

  const notes = record(project.director_notes);
  const { error: statusError } = await db.from("music_video_projects").update({
    director_notes: json({ ...notes, approved_look_asset_ids: refs }),
    status: "test_generation",
    last_error: null,
  }).eq("id", projectId).eq("owner_id", user.id);
  if (statusError) throw new Error(statusError.message);

  const brief = parseVideoCreativeBrief(project.creative_brief);
  for (const assetId of refs) {
    const generation = validByAsset.get(assetId);
    const request = record(generation?.request_payload);
    const label = typeof request.look_label === "string" ? request.look_label : "Approved look reference";
    const purpose = typeof request.look_purpose === "string" ? request.look_purpose : "Visual language";
    const prompt = typeof request.prompt === "string" ? request.prompt : "";
    await upsertCreativeAssetProfile({
      db,
      ownerId: user.id,
      artistId: artist.artistId,
      assetId,
      semanticDescriptors: [label, purpose],
      visualDescriptors: prompt ? [prompt.slice(0, 500)] : [],
      brandRelevance: 0.8,
      evidence: {
        source: "approved_video_look",
        project_id: projectId,
        label,
        purpose,
      },
      reviewed: true,
    });
    await recordCreativeMemoryEvent({
      db,
      ownerId: user.id,
      artistId: artist.artistId,
      assetId,
      releaseId: release.id,
      trackId: track.id,
      momentId: brief.anchor_moment_id,
      videoProjectId: projectId,
      eventType: "reference_approved",
      sentiment: 1,
      weight: 4.5,
      signal: `Approved visual reference: ${label}`,
      source: "video_look_review",
      idempotencyKey: `approved-look:${projectId}:${assetId}`,
      context: { label, purpose },
    });
  }

  const { data: updatedProject, error: updatedError } = await db.from("music_video_projects")
    .select("*").eq("id", projectId).eq("owner_id", user.id).single();
  if (updatedError || !updatedProject) throw new Error(updatedError?.message || "Could not reload video project.");
  await prepareShotGenerationRecords({ db, ownerId: user.id, project: updatedProject });

  revalidatePath(`/studio/video/${projectId}`);
  revalidatePath(`/studio/releases/${release.id}`);
}
