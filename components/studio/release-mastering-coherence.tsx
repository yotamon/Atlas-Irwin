import Link from "next/link";
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
          id: vault.id,
          title: track.title,
          musicMap: vault.audio_profile,
        }]
      : [];
  });
  const coherence = deriveReleaseMasteringCoherence(ordered);
  const href = (path: string) => ensemblisArtistHref(path, artistId);

  return (
    <section className="v2-section release-mastering-coherence" aria-label="Release mastering coherence">
      <div className="v2-section-heading compact">
        <div>
          <span className="section-label">Release mastering</span>
          <h2>{coherence.status === "review" ? "Listen to the sequence before locking every master" : coherence.status === "coherent" ? "The masters form a coherent sequence" : "Analyze each master to compare the release as a sequence"}</h2>
          <p>{coherence.summary}</p>
        </div>
        <span className={coherence.status === "review" ? "v2-count has-items" : "growth-active-label"}>
          {coherence.analyzedTrackCount}/{tracks.length} analyzed
        </span>
      </div>

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
            const vault = ordered.find((item) => item.id === finding.trackId);
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
          <strong>No accidental release-level mismatch stands out.</strong>
          <p>Ensemblis preserves the measured loud/quiet, dynamic and tonal relationships rather than forcing every song toward one LUFS or EQ target.</p>
        </div>
      ) : null}

      <details className="v2-advanced-disclosure">
        <summary>How release mastering is judged</summary>
        <p className="v2-muted-copy">
          This is a sequence-level review layer over the exact canonical masters. It compares relative loudness, PLR, tonal envelope and stereo character. It never normalizes every song to one target and it does not process tracks automatically.
        </p>
      </details>
    </section>
  );
}
