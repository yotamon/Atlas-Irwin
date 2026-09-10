import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseVideoCreativeBrief } from "./domain";
import { resolveProjectAudioUrl } from "./context";
import {
  QUICK_VIDEO_DERIVED_RENDER_TYPES,
  queueVideoRenderIfMissing,
  type VideoRenderType,
} from "./render";
import type { ExtendedMusicVideoProject, VideoDatabase } from "@/types/video-database";

export type QuickVideoSocialPackItem = {
  type: Exclude<VideoRenderType, "master_16_9">;
  status: "queued" | "existing" | "needs_review";
  reason: string | null;
};

export type QuickVideoSocialPackResult = {
  eligible: boolean;
  projectId: string;
  items: QuickVideoSocialPackItem[];
};

async function projectForSocialDelivery(
  db: SupabaseClient<VideoDatabase>,
  ownerId: string,
  projectId: string,
) {
  const { data, error } = await db.from("music_video_projects")
    .select("*")
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .single();
  if (error || !data) throw new Error(error?.message || "Quick Video project not found.");
  return data as ExtendedMusicVideoProject;
}

async function hasCompletedMaster(
  db: SupabaseClient<VideoDatabase>,
  ownerId: string,
  projectId: string,
) {
  const { data, error } = await db.from("music_video_renders")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("project_id", projectId)
    .eq("render_type", "master_16_9")
    .eq("status", "completed")
    .limit(1);
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

export async function queueQuickVideoSocialPack(input: {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  projectId: string;
}): Promise<QuickVideoSocialPackResult> {
  const project = await projectForSocialDelivery(input.db, input.ownerId, input.projectId);
  const brief = parseVideoCreativeBrief(project.creative_brief);
  if (brief.workflow_mode !== "quick_video") {
    return { eligible: false, projectId: project.id, items: [] };
  }
  if (!await hasCompletedMaster(input.db, input.ownerId, project.id)) {
    return { eligible: false, projectId: project.id, items: [] };
  }

  const audioUrl = await resolveProjectAudioUrl(input.db, project, input.ownerId);
  if (!audioUrl) throw new Error("Quick Video social delivery requires the project audio source.");

  const items: QuickVideoSocialPackItem[] = [];
  for (const type of QUICK_VIDEO_DERIVED_RENDER_TYPES) {
    try {
      const result = await queueVideoRenderIfMissing({
        db: input.db,
        ownerId: input.ownerId,
        project,
        type,
        audioUrl,
        allowUnsafeVertical: false,
      });
      items.push({
        type,
        status: result.queued ? "queued" : "existing",
        reason: null,
      });
    } catch (error) {
      items.push({
        type,
        status: "needs_review",
        reason: error instanceof Error ? error.message : "Derived render needs review.",
      });
    }
  }

  return { eligible: true, projectId: project.id, items };
}
