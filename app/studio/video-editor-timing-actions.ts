"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buildTrimShotStartMutation } from "@/lib/video-director/editor-policy";
import { loadVideoEditorSession } from "@/lib/video-director/editor-session";

const inputSchema = z.object({
  projectId: z.uuid(),
  shotId: z.uuid(),
  previousStartMs: z.number().int().min(0),
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
});

export async function trimVideoShotStart(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  const { user, db } = await loadVideoEditorSession(parsed.projectId);
  const { data: shot, error } = await db.from("music_video_shots")
    .select("editor_config")
    .eq("id", parsed.shotId)
    .eq("project_id", parsed.projectId)
    .eq("owner_id", user.id)
    .single();
  if (error || !shot) throw new Error(error?.message || "Video shot not found.");

  const mutation = buildTrimShotStartMutation({
    editorConfig: shot.editor_config,
    previousStartMs: parsed.previousStartMs,
    startMs: parsed.startMs,
    endMs: parsed.endMs,
    trimmedAt: new Date().toISOString(),
  });
  const { error: updateError } = await db.from("music_video_shots").update(mutation)
    .eq("id", parsed.shotId)
    .eq("project_id", parsed.projectId)
    .eq("owner_id", user.id);
  if (updateError) throw new Error(updateError.message);
  revalidatePath(`/studio/video/${parsed.projectId}`);
}
