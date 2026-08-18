"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { createServiceClient } from "@/lib/supabase/service";
import { parseMusicMap } from "@/lib/video-director/creative-director";
import {
  createWorkerThumbnailUploadTarget,
  mediaWorkerReadiness,
  queueMediaWorkerJob,
} from "@/lib/video-director/worker";
import type { Json } from "@/types/database";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function metadata(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function candidateTimestamps(musicMap: Json, durationMs: number) {
  const map = parseMusicMap(musicMap);
  const duration = map?.duration_ms || durationMs;
  if (duration <= 0) throw new Error("Track duration is unavailable for thumbnail extraction.");
  const margin = Math.min(3000, Math.max(500, Math.round(duration * 0.03)));
  const clamp = (ms: number) => Math.max(margin, Math.min(Math.max(margin, duration - margin), Math.round(ms)));

  const strongestSections = [...(map?.sections ?? [])]
    .sort((a, b) => b.energy - a.energy)
    .map((section) => Math.round((section.start_ms + section.end_ms) / 2));
  const candidates = [
    ...(map?.peaks_ms ?? []),
    ...strongestSections,
    Math.round(duration * 0.33),
    Math.round(duration * 0.5),
    Math.round(duration * 0.72),
  ].map(clamp);

  const result: number[] = [];
  for (const timestamp of candidates) {
    if (result.every((existing) => Math.abs(existing - timestamp) >= 5000)) result.push(timestamp);
    if (result.length >= 4) break;
  }
  while (result.length < 4) {
    const fallback = clamp(duration * ((result.length + 1) / 5));
    if (result.every((existing) => Math.abs(existing - fallback) >= 1500)) result.push(fallback);
    else break;
  }
  return result;
}

export async function generateVideoThumbnailCandidates(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const { user } = await requireStudioAdmin();
  const db = createServiceClient();
  if (!mediaWorkerReadiness().configured) throw new Error("Media Worker is not configured.");

  const { data: project, error: projectError } = await db.from("music_video_projects")
    .select("*")
    .eq("id", projectId)
    .eq("owner_id", user.id)
    .single();
  if (projectError || !project) throw new Error(projectError?.message || "Video project not found.");
  if (project.status !== "complete") throw new Error("Finish the master before extracting thumbnail candidates.");

  const { data: render, error: renderError } = await db.from("music_video_renders")
    .select("*")
    .eq("project_id", project.id)
    .eq("owner_id", user.id)
    .eq("render_type", "master_16_9")
    .eq("status", "completed")
    .not("media_asset_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (renderError || !render?.media_asset_id) throw new Error(renderError?.message || "Completed master asset not found.");

  const { data: source, error: sourceError } = await db.from("media_assets")
    .select("*")
    .eq("id", render.media_asset_id)
    .eq("owner_id", user.id)
    .single();
  if (sourceError || !source?.public_url) throw new Error(sourceError?.message || "Master video URL is unavailable.");

  const map = parseMusicMap(project.music_map);
  const timestamps = candidateTimestamps(project.music_map, source.duration_ms || map?.duration_ms || 0);
  if (!timestamps.length) throw new Error("Atlas could not choose safe thumbnail timestamps.");
  const jobs = [];

  for (const timestampMs of timestamps) {
    const candidateId = `${project.id}-${timestampMs}`;
    const upload = await createWorkerThumbnailUploadTarget(db, user.id, project.id, candidateId);
    jobs.push(await queueMediaWorkerJob({
      db,
      project,
      ownerId: user.id,
      jobType: "extract_frame",
      payload: {
        candidate_id: candidateId,
        source_url: source.public_url,
        source_asset_id: source.id,
        timestamp_ms: timestampMs,
        max_width: 1600,
        upload_url: upload.signedUrl,
        upload_bucket: upload.bucket,
        upload_path: upload.path,
        public_url: upload.publicUrl,
      },
      idempotencyKey: `thumbnail:${candidateId}`,
    }));
  }

  revalidatePath(`/studio/video/${project.id}`);
  return { queued: jobs.length };
}

export async function selectVideoThumbnail(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const assetId = z.uuid().parse(value(form, "asset_id"));
  const { user } = await requireStudioAdmin();
  const db = createServiceClient();

  const [{ data: project, error: projectError }, { data: asset, error: assetError }] = await Promise.all([
    db.from("music_video_projects").select("id,release_id,owner_id,status").eq("id", projectId).eq("owner_id", user.id).single(),
    db.from("media_assets").select("*").eq("id", assetId).eq("owner_id", user.id).single(),
  ]);
  if (projectError || !project) throw new Error(projectError?.message || "Video project not found.");
  if (project.status !== "complete") throw new Error("Thumbnail selection is available after the master completes.");
  if (assetError || !asset) throw new Error(assetError?.message || "Thumbnail asset not found.");
  if (asset.asset_type !== "thumbnail" || metadata(asset.metadata).project_id !== project.id) {
    throw new Error("Thumbnail candidate does not belong to this video project.");
  }

  const { data: projectThumbnails, error: thumbnailError } = await db.from("media_assets")
    .select("id,metadata")
    .eq("owner_id", user.id)
    .eq("asset_type", "thumbnail")
    .contains("metadata", { project_id: project.id });
  if (thumbnailError) throw new Error(thumbnailError.message);
  for (const item of projectThumbnails ?? []) {
    const next = { ...metadata(item.metadata), selected_thumbnail: item.id === asset.id } as Json;
    const { error } = await db.from("media_assets").update({ metadata: next }).eq("id", item.id).eq("owner_id", user.id);
    if (error) throw new Error(error.message);
  }

  const { error: clearError } = await db.from("media_links")
    .update({ is_primary: false })
    .eq("owner_id", user.id)
    .eq("release_id", project.release_id)
    .eq("role", "thumbnail");
  if (clearError) throw new Error(clearError.message);

  const { data: existing, error: linkLookupError } = await db.from("media_links")
    .select("id")
    .eq("owner_id", user.id)
    .eq("release_id", project.release_id)
    .eq("media_asset_id", asset.id)
    .eq("role", "thumbnail")
    .maybeSingle();
  if (linkLookupError) throw new Error(linkLookupError.message);
  const linkValues = {
    owner_id: user.id,
    media_asset_id: asset.id,
    release_id: project.release_id,
    track_id: null,
    content_item_id: null,
    role: "thumbnail",
    is_primary: true,
    caption: "Selected Atlas Video Director thumbnail",
    alt_text: null,
  };
  const { error: linkError } = existing
    ? await db.from("media_links").update(linkValues).eq("id", existing.id)
    : await db.from("media_links").insert(linkValues);
  if (linkError) throw new Error(linkError.message);

  revalidatePath(`/studio/video/${project.id}`);
  revalidatePath(`/studio/releases/${project.release_id}`);
  revalidatePath("/studio/media");
}
