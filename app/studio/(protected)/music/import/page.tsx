import Link from "next/link";
import { MediaUploader } from "@/components/studio/media-uploader";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { vaultAnalysisReadiness } from "@/lib/studio/vault-analysis";
import type { VaultTrack } from "@/types/growth-database";

function hasMusicMap(track: VaultTrack) {
  return Boolean(
    track.audio_profile
    && typeof track.audio_profile === "object"
    && !Array.isArray(track.audio_profile)
    && Object.keys(track.audio_profile).length,
  );
}

function analysisStatus(track: VaultTrack) {
  if (hasMusicMap(track)) return "Understood";
  if (!track.analysis || typeof track.analysis !== "object" || Array.isArray(track.analysis)) return "Preparing analysis";
  const status = (track.analysis as Record<string, unknown>).status;
  if (status === "queued" || status === "running") return "Understanding…";
  if (status === "failed") return "Needs retry";
  if (status === "unavailable") return "Analysis unavailable";
  return track.audio_url ? "Preparing analysis" : "Needs master";
}

export default async function MusicImportPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);
  const growth = asGrowthClient(supabase);
  const { data: recent, error } = await growth.from("track_vault")
    .select("*")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) throw new Error(error.message);
  const worker = vaultAnalysisReadiness();

  return (
    <div className="studio-v2-page growth-import-page music-import-page">
      <PageHeader
        title="Add mastered music"
        description={`Upload ${artist.artistName}'s mastered tracks. Title is optional; Ensemblis starts understanding structure and strongest moments automatically.`}
        action={<Link className="button" href={href("/studio/music")}>Back to Music</Link>}
      />

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Master intake</span>
            <h2>Give Ensemblis the song. It handles the analysis.</h2>
          </div>
          <span className={`v2-dot ${worker.configured ? "connected" : ""}`} aria-hidden />
        </div>
        <p className="v2-muted-copy">
          Upload the real master and move on. Track Intelligence maps musical structure, energy and strongest moments without asking you to score the song by hand.
        </p>
        {!worker.configured ? (
          <div className="notice">
            Automatic audio analysis is unavailable in this environment. The master is still saved safely in Music and can be analyzed when the media worker is available.
          </div>
        ) : null}
        <MediaUploader
          artistId={artist.artistId}
          defaultRole="master_audio"
          musicIntakeMode
        />
      </section>

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Recent music</span>
            <h2>What Ensemblis is understanding</h2>
          </div>
          <Link href={href("/studio/music")}>All music</Link>
        </div>
        {recent?.length ? (
          <div className="growth-vault-list">
            {recent.map((track) => (
              <Link className="growth-import-row" href={href(`/studio/music/${track.id}`)} key={track.id}>
                <div>
                  <strong>{track.title}</strong>
                  <small>{track.status.replaceAll("_", " ")} · {analysisStatus(track)}</small>
                </div>
                <div><span>{hasMusicMap(track) ? "Structure and strongest moments ready" : "Automatic Track Intelligence"}</span></div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="v2-calm-state compact">
            <strong>No mastered tracks yet.</strong>
            <p>Upload one master. Ensemblis will create the reusable music record and begin understanding it automatically.</p>
          </div>
        )}
      </section>
    </div>
  );
}