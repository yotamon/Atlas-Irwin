"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buildHumanQualityApprovalMutation } from "@/lib/video-director/editor-policy";
import { loadVideoEditorSession } from "@/lib/video-director/editor-session";

const inputSchema = z.object({ projectId: z.uuid(), shotId: z.uuid() });

export async function approveVideoShotHumanQuality(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  const { user, db } = await loadVideoEditorSession(parsed.projectId);
  const { data: shot, error } = await db.from("music_video_shots").select("*")
    .eq("id", parsed.shotId)
    .eq("project_id", parsed.projectId)
    .eq("owner_id", user.id)
    .single();
  if (error || !shot) throw new Error(error?.message || "Shot not found.");

  const mutation = buildHumanQualityApprovalMutation({
    shot,
    reviewerId: user.id,
    reviewedAt: new Date().toISOString(),
  });
  const { error: updateError } = await db.from("music_video_shots").update(mutation)
    .eq("id", shot.id)
    .eq("project_id", parsed.projectId)
    .eq("owner_id", user.id);
  if (updateError) throw new Error(updateError.message);
  revalidatePath(`/studio/video/${parsed.projectId}`);
}
