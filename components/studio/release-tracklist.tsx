import Link from "next/link";
import { MediaUploader } from "@/components/studio/media-uploader";
import { Status } from "@/components/studio/ui";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import type { Track } from "@/types/database";
import type { VaultTrack } from "@/types/growth-database";

function trackLabel(track: Track, index: number) {
  return track.track_number ?? track.display_order + 1 ?? index + 1;
}

function analysisState(vault: VaultTrack | null) {
  if (!vault) return "Not analyzed";
  const analysis = vault.analysis && typeof vault.analysis === "object" && !Array.isArray(vault.analysis)
    ? vault.analysis as Record<string, unknown>
    : {};
  const status = typeof analysis.status === "string" ? analysis.status : "";
  if (["queued", "dispatched", "running", "pending"].includes(status)) return "Analyzing";
  if (vault.analysis_confidence > 0 || Object.keys(vault.audio_profile as object).length) return "Understood";
  return "Ready to analyze";
}

export function ReleaseTracklist({
  releaseId,
  artistId,
  tracks,
  vaultTracks,
}: {
  releaseId: string;
  artistId: string;
  tracks: Track[];
  vaultTracks: VaultTrack[];
}) {
  const exactVaults = new Map(vaultTracks.filter((vault) => vault.linked_track_id).map((vault) => [vault.linked_track_id as string, vault]));
  const legacySingleVault = tracks.length === 1 ? vaultTracks.find((vault) => !vault.linked_track_id) ?? null : null;

  return (
    <section className="v2-section release-tracklist" aria-labelledby="release-tracks-heading">
      <div className="v2-section-heading">
        <div>
          <span className="section-label">Music</span>
          <h2 id="release-tracks-heading">{tracks.length ? `${tracks.length} track${tracks.length === 1 ? "" : "s"} in this release` : "Add the music in this release"}</h2>
          <p>Every song has its own master and Music Intelligence. Open the exact track you want to work on.</p>
        </div>
      </div>

      {tracks.length ? (
        <div className="v2-inbox release-tracklist-rows">
          {tracks.map((track, index) => {
            const vault = exactVaults.get(track.id) ?? legacySingleVault;
            const hasMaster = Boolean(track.audio_url || vault?.audio_url);
            const trackHref = ensemblisArtistHref(`/studio/music/${vault?.id ?? track.id}`, artistId);
            return (
              <div className="v2-inbox-item release-track-row" key={track.id}>
                <Link className="release-track-main" href={trackHref}>
                  <span className="release-track-number" aria-label={`Track ${trackLabel(track, index)}`}>{trackLabel(track, index)}</span>
                  <span className="release-track-copy">
                    <strong>{track.title}{track.version ? ` · ${track.version}` : ""}</strong>
                    <small>{hasMaster ? `${analysisState(vault ?? null)} · open track workspace` : "Master needed · add it here or open the track"}</small>
                  </span>
                </Link>
                <div className="release-track-actions">
                  <Status tone={hasMaster ? "success" : "attention"}>{hasMaster ? "Master ready" : "Needs master"}</Status>
                  <Link className="button" href={trackHref}>{hasMaster ? "Open track" : "Open"}</Link>
                </div>
                {!hasMaster ? (
                  <details className="v2-advanced-disclosure release-track-master-upload">
                    <summary>Add master</summary>
                    <MediaUploader
                      releaseId={releaseId}
                      trackId={track.id}
                      artistId={artistId}
                      defaultRole="master_audio"
                      releaseMasterMode
                    />
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="v2-calm-state compact">
          <strong>No tracks are attached to this release yet.</strong>
          <p>Add the track metadata first, then each song can receive its own master and intelligence.</p>
        </div>
      )}
    </section>
  );
}
