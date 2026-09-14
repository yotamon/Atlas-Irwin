import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { activeCapabilitiesForOwner } from "@/lib/licensing/capabilities";
import type { MediaWorkerJobType } from "@/lib/media-worker/contract";
import { createServiceClient } from "@/lib/supabase/service";
import type { AutoMixDatabase } from "@/types/automix-database";
import type { MasteringDatabase } from "@/types/mastering-database";

async function masteringOwner(jobId: string) {
  const db = createServiceClient() as unknown as SupabaseClient<MasteringDatabase>;
  const { data, error } = await db
    .from("track_mastering_jobs")
    .select("owner_id")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.owner_id ?? null;
}

async function automixOwner(jobId: string, preview: boolean) {
  const db = createServiceClient() as unknown as SupabaseClient<AutoMixDatabase>;
  const table = preview ? "automix_transition_previews" : "automix_jobs";
  const { data, error } = await db
    .from(table)
    .select("owner_id")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.owner_id ?? null;
}

export async function persistedMediaWorkerEntitlements(jobType: MediaWorkerJobType, jobId: string) {
  const ownerId = jobType === "master_audio"
    ? await masteringOwner(jobId)
    : jobType === "render_automix"
      ? await automixOwner(jobId, false)
      : jobType === "render_automix_preview"
        ? await automixOwner(jobId, true)
        : null;

  if (!ownerId) {
    throw new Error(
      `Media Worker execution requires explicit authorization or a durable owner-backed queue row for ${jobType}.`,
    );
  }
  return activeCapabilitiesForOwner(ownerId);
}
