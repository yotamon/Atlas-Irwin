import Link from "next/link";
import { ReleaseMasteringSequencePlayer } from "@/components/studio/release-mastering-sequence-player";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { deriveReleaseMasteringCoherence } from "@/lib/mastering/release-coherence";
import type { Track } from "@/types/database";
import type { VaultTrack } from "@/types/growth-database";

function metric(value: number | null, suffix: string) {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
}

export function ReleaseMasteringCoherence({
  artistId,
  tracks,
  vaultTracks,
}: {
  artistId: string;
  tracks: Track[];
  vaultTracks: VaultTrack[];
}) {
  if (tracks.length < 2) return null;

  const byTrack = new Map(
    vaultTracks
      .filter((vault) => vault.linked_track_id)
      .map((vault) => [vault.linked_track_id as string, vault]),
  );
  const ordered = tracks.flatMap((track) => {
    const vault = byTrack.get(track.id);
    return vault
      ? [{
          id: track.id,
          title: track.title,
          musicMap: vault.audio_profile,
        }]
      : [];
  });
  const coherence = deriveReleaseMasteringCoherence(ordered);
  const href = (path: string) => ensemblisArtistHref(path, artistId);
  const needsReview = coherence.status === "review";

  return (
    <details
      className="release-mastering-coherence release-v5-secondary"
      aria-label="Release mastering"
      open={needsReview || undefined}
    >
      <summary>
        <span>
          <small>Release mastering</small>
          <strong>{needsReview ? "The sequence needs a listen" : coherence.status === "coherent" ? "Masters sound coherent together" : "Compare masters as a sequence"}</strong>
        </span>
        <span className={needsReview ? "v2-count has-items" : "growth-active-label"}>
          {coherence.analyzedTrackCount}/{tracks.length}
        </span>
      </summary>

      <div className="release-v5-secondary-body">
        <p className="v2-muted-copy">{coherence.summary}</p>

        <ReleaseMasteringSequencePlayer
          tracks={tracks.flatMap((track) => {
            const vault = byTrack.get(track.id);
            return vault?.audio_url
              ? [{ id: track.id, title: track.title, url: vault.audio_url }]
              : [];
          })}
        />

        {coherence.relationships.length ? (
          <div className="release-mastering-sequence" aria-label="Adjacent track relationships">
            {coherence.relationships.map((relationship, index) => {
              const from = tracks.find((track) => track.id === relationship.fromTrackId);
              const to = tracks.find((track) => track.id === relationship.toTrackId);
              return (
                <div key={`${relationship.fromTrackId}-${relationship.toTrackId}`}>
                  <span>{index + 1} → {index + 2}</span>
                  <strong>{from?.title ?? "Previous"} → {to?.title ?? "Next"}</strong>
                  <small>
                    Loudness {metric(relationship.loudnessDeltaLu, " LU")} · PLR {metric(relationship.plrDeltaLu, " LU")}
                  </small>
                </div>
              );
            })}
          </div>
        ) : null}

        {coherence.findings.length ? (
          <div className="v2-inbox">
            {coherence.findings.slice(0, 6).map((finding) => {
              const vault = byTrack.get(finding.trackId);
              return vault ? (
                <Link
                  className="v2-inbox-item"
                  href={href(`/studio/music/${vault.id}#mastering`)}
                  key={`${finding.code}-${finding.trackId}`}
                >
                  <div>
                    <strong>{finding.title}</strong>
                    <small>{finding.summary}</small>
                  </div>
                  <b aria-hidden>→</b>
                </Link>
              ) : null;
            })}
          </div>
        ) : coherence.status === "coherent" ? (
          <div className="v2-calm-state compact">
            <strong>No accidental mismatch stands out.</strong>
            <p>The measured loudness, dynamics and tonal relationships remain intentionally different where the songs call for it.</p>
          </div>
        ) : null}

        <details className="v2-advanced-disclosure">
          <summary>Engineering criteria</summary>
          <p className="v2-muted-copy">
            Sequence review compares relative loudness, PLR, tonal envelope and stereo character across the exact canonical masters. It never normalizes every song to one target; intentional contrast stays intact.
          </p>
        </details>
      </div>
    </details>
  );
}
