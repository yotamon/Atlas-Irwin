"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { createServiceClient } from "@/lib/supabase/service";
import { loadVideoProjectContext } from "@/lib/video-director/context";
import type { Json } from "@/types/database";
import type { VideoDatabase } from "@/types/video-database";
import type { SupabaseClient } from "@supabase/supabase-js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function json(value: unknown) {
  return value as Json;
}

const inputSchema = z.object({ projectId: z.uuid(), shotId: z.uuid() });

export async function approveVideoShotHumanQuality(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const baseDb = createServiceClient();
  const context = await loadVideoProjectContext(baseDb, parsed.projectId, user.id, artist.artistId);
  if (context.project.status === "archived") throw new Error("Archived video projects are read only.");
  const db = baseDb as unknown as SupabaseClient<VideoDatabase>;
  const { data: shot, error } = await db.from("music_video_shots").select("*")
    .eq("id", parsed.shotId).eq("project_id", parsed.projectId).eq("owner_id", user.id).single();
  if (error || !shot) throw new Error(error?.message || "Shot not found.");
  if (shot.status !== "locked" || !shot.selected_asset_id) throw new Error("Choose and lock the exact shot variant before quality approval.");

  const performance = record(shot.performance_config);
  const needsLipSync = shot.shot_type === "performance" && performance.lip_sync === true;
  const needsContinuity = Boolean(shot.character_id);
  if (!needsLipSync && !needsContinuity) throw new Error("This shot does not require identity or lip-sync attestation.");

  const current = record(shot.quality_checks);
  const reviewedAt = new Date().toISOString();
  const { error: updateError } = await db.from("music_video_shots").update({
    quality_checks: json({
      ...current,
      review_asset_id: shot.selected_asset_id,
      human_reviewed_at: reviewedAt,
      human_reviewer_id: user.id,
      continuity_approved: needsContinuity ? true : current.continuity_approved === true,
      lip_sync_approved: needsLipSync ? true : current.lip_sync_approved === true,
      lip_sync_review_method: needsLipSync ? "explicit_human_attestation" : current.lip_sync_review_method ?? null,
      continuity_review_method: needsContinuity ? "explicit_human_attestation" : current.continuity_review_method ?? null,
    }),
  }).eq("id", shot.id).eq("owner_id", user.id);
  if (updateError) throw new Error(updateError.message);
  revalidatePath(`/studio/video/${parsed.projectId}`);
}
