import { ActiveMasteringControls } from "@/components/studio/active-mastering-controls";
import { MasteringAnalysisReport } from "@/components/studio/mastering-analysis-report";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMasteringClient } from "@/lib/mastering/jobs";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import type { Json } from "@/types/database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function runDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
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
    .order("created_at", { ascending: false });
  if (jobs.error) throw new Error(jobs.error.message);

  const serialized = (jobs.data ?? []).map((job) => {
    const request = record(job.request_payload);
    return {
      id: job.id,
      preset: job.preset,
      status: job.status,
      error: job.error ? "The mastering worker could not complete this render." : null,
      createdAt: job.created_at,
      outputUrl: job.status === "completed" && typeof request.public_url === "string" ? request.public_url : null,
      result: job.result_payload as Json,
    };
  });

  return (
    <>
      <ActiveMasteringControls
        artistId={artist.artistId}
        trackId={trackId}
        sourceAudioUrl={sourceAudioUrl}
        jobs={serialized.slice(0, 4)}
      />

      {serialized.length > 4 ? (
        <details className="workspace-drawer">
          <summary>Earlier mastering runs ({serialized.length - 4})</summary>
          <p className="v2-muted-copy">
            The main workspace keeps the newest candidates in focus. Older renders remain available with the same human-readable verification evidence.
          </p>
          <div className="mastering-history-list">
            {serialized.slice(4).map((job) => (
              <details key={job.id} className="mastering-history-run">
                <summary>
                  {job.preset.charAt(0).toUpperCase() + job.preset.slice(1)} · {job.status} · {runDate(job.createdAt)}
                </summary>
                {job.error ? <p className="v2-muted-copy" role="alert">{job.error}</p> : null}
                {job.outputUrl ? <p><a className="button" href={job.outputUrl} download>Download rendered WAV</a></p> : null}
                <MasteringAnalysisReport result={job.result} compact />
              </details>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}
