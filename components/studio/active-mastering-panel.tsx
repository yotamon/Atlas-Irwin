import { ActiveMasteringControls } from "@/components/studio/active-mastering-controls";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMasteringClient } from "@/lib/mastering/jobs";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import type { Json } from "@/types/database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function ActiveMasteringPanel({
  trackId,
  sourceAudioUrl,
}: {
  trackId: string;
  sourceAudioUrl: string | null;
}) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const db = asMasteringClient(supabase);
  const jobs = await db.from("track_mastering_jobs")
    .select("*")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .eq("track_vault_id", trackId)
    .order("created_at", { ascending: false })
    .limit(4);
  if (jobs.error) throw new Error(jobs.error.message);

  const serialized = (jobs.data ?? []).map((job) => {
    const request = record(job.request_payload);
    return {
      id: job.id,
      preset: job.preset,
      status: job.status,
      error: job.error,
      createdAt: job.created_at,
      outputUrl: job.status === "completed" && typeof request.public_url === "string" ? request.public_url : null,
      result: job.result_payload as Json,
    };
  });

  return (
    <ActiveMasteringControls
      trackId={trackId}
      sourceAudioUrl={sourceAudioUrl}
      jobs={serialized}
    />
  );
}
