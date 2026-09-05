/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { MusicIntelligencePreview } from "@/components/studio/music-intelligence-preview";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import type { VaultTrack } from "@/types/growth-database";

type ReleaseSummary = {
  id: string;
  title: string;
  status: string;
  release_date: string | null;
  artwork_url: string | null;
  cover_alt: string | null;
  active_release: boolean;
};

type TrackSummary = {
  id: string;
  title: string;
  release_id: string;
  audio_url: string | null;
  is_primary: boolean;
};

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortDate(value: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function hasMusicMap(track: VaultTrack) {
  return Boolean(
    track.audio_profile
    && typeof track.audio_profile === "object"
    && !Array.isArray(track.audio_profile)
    && Object.keys(track.audio_profile).length,
  );
}

function analysisStatus(track: VaultTrack) {
  if (hasMusicMap(track)) return "Understanding ready";
  if (!track.audio_url) return "Needs master";
  if (track.analysis && typeof track.analysis === "object" && !Array.isArray(track.analysis)) {
    const status = (track.analysis as Record<string, unknown>).status;
    if (status === "queued" || status === "running") return "Understanding…";
    if (status === "failed") return "Analysis needs attention";
    if (status === "unavailable") return "Analysis unavailable";
  }
  return "Master ready";
}

export function MusicWorkspaceOverview({
  artistId,
  artistName,
  vaultTracks,
  releases,
  tracks,
}: {
  artistId: string;
  artistName: string;
  vaultTracks: VaultTrack[];
  releases: ReleaseSummary[];
  tracks: TrackSummary[];
}) {
  const unreleased = vaultTracks.filter((track) => !track.linked_release_id);
  const focusTrack = unreleased[0] ?? null;
  const remaining = focusTrack
    ? unreleased.filter((track) => track.id !== focusTrack.id)
    : unreleased;
  const analyzedCount = unreleased.filter(hasMusicMap).length;
  const masteredCount = unreleased.filter((track) => Boolean(track.audio_url)).length;
  const trackCountByRelease = new Map<string, number>();
  for (const track of tracks) {
    trackCountByRelease.set(track.release_id, (trackCountByRelease.get(track.release_id) ?? 0) + 1);
  }
  const addHref = ensemblisArtistHref("/studio/music?view=add", artistId);
  const importHref = ensemblisArtistHref("/studio/music/import", artistId);
  const generateHref = ensemblisArtistHref("/studio/music?view=generate", artistId);
  const trackHref = (trackId: string) => ensemblisArtistHref(`/studio/music/${trackId}`, artistId);
  const createHref = (trackId: string) => ensemblisArtistHref(`/studio/create?intent=asset&track=${trackId}`, artistId);

  return (
    <div className="music-workspace-overview">
      <section className="music-workspace-summary" aria-label={`${artistName} music summary`}>
        <div><strong>{unreleased.length}</strong><span>unreleased</span></div>
        <div><strong>{masteredCount}</strong><span>masters ready</span></div>
        <div><strong>{analyzedCount}</strong><span>understood</span></div>
        <div><strong>{tracks.length}</strong><span>catalog tracks</span></div>
      </section>

      <div className="music-workspace-focus-grid">
        <section className="v2-section music-workspace-focus">
          <div className="v2-section-heading">
            <div>
              <span className="section-label">Track understanding</span>
              <h2>{focusTrack ? focusTrack.title : "Add the music Ensemblis should understand"}</h2>
            </div>
            {focusTrack ? <span className="music-score">{hasMusicMap(focusTrack) ? "Ready" : "Listening"}</span> : null}
          </div>

          {focusTrack ? (
            <>
              <div className="music-track-meta-line">
                <span>{titleCase(focusTrack.status)}</span>
                <span>{analysisStatus(focusTrack)}</span>
                {focusTrack.version ? <span>{focusTrack.version}</span> : null}
              </div>
              <p className="v2-muted-copy">
                {hasMusicMap(focusTrack)
                  ? "Ensemblis has mapped the musical structure and strongest moments. Hear the evidence below, then use the track directly in Create."
                  : focusTrack.audio_url
                    ? "The master is safely in Music. Ensemblis is preparing its structural and strongest-moment understanding automatically."
                    : "Attach the canonical master so Ensemblis can understand the actual song before recommending creative work."}
              </p>
              {focusTrack.audio_url && !hasMusicMap(focusTrack) ? (
                <audio className="music-workspace-audio" controls preload="metadata" src={focusTrack.audio_url} />
              ) : null}
              {hasMusicMap(focusTrack) ? (
                <MusicIntelligencePreview
                  audioUrl={focusTrack.audio_url}
                  musicMap={focusTrack.audio_profile}
                />
              ) : (
                <div className="v2-calm-state compact">
                  <strong>{focusTrack.audio_url ? "No action needed while Ensemblis is listening." : "Master audio is missing."}</strong>
                  <p>{focusTrack.audio_url ? "When Track Intelligence is ready, this surface will show the musical timeline and strongest moments automatically." : "Add the mastered source instead of filling in manual scores."}</p>
                </div>
              )}
              <div className="actions">
                <Link className="button primary" href={trackHref(focusTrack.id)}>Open track</Link>
                {hasMusicMap(focusTrack) ? <Link className="button" href={createHref(focusTrack.id)}>Create from this track</Link> : null}
              </div>
            </>
          ) : (
            <div className="v2-calm-state compact">
              <strong>No unreleased music is waiting here.</strong>
              <p>Add an existing master, prepare a release, or create something new. Ensemblis will keep source audio, intelligence and release context connected.</p>
              <Link className="button primary" href={importHref}>Add mastered track</Link>
            </div>
          )}
        </section>

        <aside className="v2-section music-catalog-glance">
          <div className="v2-section-heading">
            <div><span className="section-label">Catalog</span><h2>Release music</h2></div>
            <Link href={ensemblisArtistHref("/studio/releases", artistId)}>All releases</Link>
          </div>
          {releases.length ? (
            <div className="music-catalog-list">
              {releases.slice(0, 6).map((release) => (
                <Link href={ensemblisArtistHref(`/studio/releases/${release.id}`, artistId)} key={release.id}>
                  <span className="music-catalog-artwork">
                    {release.artwork_url ? <img src={release.artwork_url} alt={release.cover_alt || ""} /> : release.title.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{release.title}</strong>
                    <small>{release.status} · {trackCountByRelease.get(release.id) ?? 0} track{(trackCountByRelease.get(release.id) ?? 0) === 1 ? "" : "s"} · {shortDate(release.release_date)}</small>
                  </span>
                  <b aria-hidden>→</b>
                </Link>
              ))}
            </div>
          ) : (
            <div className="v2-calm-state compact"><strong>No releases yet.</strong><p>When a track becomes a release, its master, Track Intelligence, stems and lyrics stay connected in the release workspace.</p></div>
          )}
        </aside>
      </div>

      <section className="v2-section music-unreleased-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Unreleased music</span>
            <h2>{remaining.length ? `${remaining.length} more track${remaining.length === 1 ? "" : "s"}` : focusTrack ? "One clear track in focus" : "Your unreleased music"}</h2>
          </div>
          <Link href={importHref}>Add master</Link>
        </div>
        {remaining.length ? (
          <div className="music-track-list">
            {remaining.map((track, index) => (
              <div className="music-track-row" key={track.id}>
                <span className="music-track-rank">{String(index + 2).padStart(2, "0")}</span>
                <span className="music-track-copy">
                  <strong>{track.title}</strong>
                  <small>{titleCase(track.status)} · {analysisStatus(track)}{track.version ? ` · ${track.version}` : ""}</small>
                </span>
                {track.audio_url ? <audio controls preload="metadata" src={track.audio_url} /> : <span className="music-track-missing">No master</span>}
                <span className="music-score small">{hasMusicMap(track) ? "Ready" : "Listening"}</span>
                <Link className="music-row-link" href={trackHref(track.id)}>Open →</Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="v2-calm-state compact inline">
            <strong>{focusTrack ? "Nothing else needs your attention." : "No mastered tracks yet."}</strong>
            <p>{focusTrack ? "Music stays quiet when there is no second decision to make." : "Upload a real master and let Ensemblis do the analytical work automatically."}</p>
          </div>
        )}
      </section>

      <section className="music-workspace-create-callout">
        <div>
          <span className="section-label">Bring music into Ensemblis</span>
          <h2>Start with the song, however it was made.</h2>
          <p>Upload an existing master, prepare a catalog release, or create a new draft with AI. Ensemblis becomes valuable after it can understand the actual music.</p>
        </div>
        <div className="actions">
          <Link className="button primary" href={addHref}>Add music</Link>
          <Link className="button" href={generateHref}>Create with AI</Link>
        </div>
      </section>
    </div>
  );
}