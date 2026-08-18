import "server-only";

import type { Json } from "@/types/database";
import type { VideoDatabase } from "@/types/video-database";
import type { SupabaseClient } from "@supabase/supabase-js";

function strings(value: Json): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function history(value: Json): Json[] {
  return Array.isArray(value) ? value : [];
}

export async function recordDirectorPreference(input: {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  signal: string;
  positive: boolean;
  projectId: string;
  shotId?: string | null;
  generationId?: string | null;
  note?: string | null;
}) {
  const clean = input.signal.trim().slice(0, 240);
  if (!clean) return;
  const { data: current, error } = await input.db.from("music_video_director_preferences")
    .select("*").eq("owner_id", input.ownerId).maybeSingle();
  if (error) throw new Error(error.message);
  const positive = current ? strings(current.positive_signals) : [];
  const negative = current ? strings(current.negative_signals) : [];
  const target = input.positive ? positive : negative;
  const opposite = input.positive ? negative : positive;
  const nextTarget = [clean, ...target.filter((item) => item !== clean)].slice(0, 60);
  const nextOpposite = opposite.filter((item) => item !== clean);
  const nextHistory: Json[] = [
    {
      at: new Date().toISOString(),
      signal: clean,
      positive: input.positive,
      project_id: input.projectId,
      shot_id: input.shotId ?? null,
      generation_id: input.generationId ?? null,
      note: input.note?.trim().slice(0, 500) || null,
    },
    ...(current ? history(current.feedback_history) : []),
  ].slice(0, 120);
  const { error: upsertError } = await input.db.from("music_video_director_preferences").upsert({
    owner_id: input.ownerId,
    positive_signals: input.positive ? nextTarget : nextOpposite,
    negative_signals: input.positive ? nextOpposite : nextTarget,
    feedback_history: nextHistory,
  }, { onConflict: "owner_id" });
  if (upsertError) throw new Error(upsertError.message);
}
