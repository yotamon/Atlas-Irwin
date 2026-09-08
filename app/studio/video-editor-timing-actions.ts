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

const inputSchema = z.object({
  projectId: z.uuid(),
  shotId: z.uuid(),
  previousStartMs: z.number().int().min(0),
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
});

export async function trimVideoShotStart(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  if (parsed.endMs <= parsed.startMs) throw new Error("Shot end must be after its start.");

  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const baseDb = createServiceClient();
  const context = await loadVideoProjectContext(baseDb, parsed.projectId, user.id, artist.artistId);
  if (context.project.status === "archived") throw new Error("Archived video projects are read only.");
  const db = baseDb as unknown as SupabaseClient<VideoDatabase>;
  const { data: shot, error } = await db.from("music_video_shots")
    .select("editor_config")
    .eq("id", parsed.shotId)
    .eq("project_id", parsed.projectId)
    .eq("owner_id", user.id)
    .single();
  if (error || !shot) throw new Error(error?.message || "Video shot not found.");

  const editorConfig = record(shot.editor_config);
  const currentSourceOffset = typeof editorConfig.source_offset_ms === "number" && Number.isFinite(editorConfig.source_offset_ms)
    ? Math.max(0, Math.round(editorConfig.source_offset_ms))
    : 0;
  const trimDelta = parsed.startMs - parsed.previousStartMs;
  const sourceOffsetMs = Math.max(0, currentSourceOffset + trimDelta);

  const { error: updateError } = await db.from("music_video_shots").update({
    start_ms: parsed.startMs,
    end_ms: parsed.endMs,
    editor_config: json({
      ...editorConfig,
      source_offset_ms: sourceOffsetMs,
      last_trim: {
        kind: "start",
        timeline_delta_ms: trimDelta,
        source_offset_ms: sourceOffsetMs,
        trimmed_at: new Date().toISOString(),
      },
    }),
  }).eq("id", parsed.shotId).eq("project_id", parsed.projectId).eq("owner_id", user.id);
  if (updateError) throw new Error(updateError.message);
  revalidatePath(`/studio/video/${parsed.projectId}`);
}