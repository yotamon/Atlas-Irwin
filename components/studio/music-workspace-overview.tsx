/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { MusicIntelligencePreview } from "@/components/studio/music-intelligence-preview";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { rankVaultTracks } from "@/lib/studio/growth";
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

function analysisLabel(track: VaultTrack) {
  if (hasMusicMap(track)) return "Intelligence ready";
  if (track.audio_url) return "Master ready";
  return "Needs master";
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
  const ranked = rankVaultTracks(vaultTracks);
  const unreleased = ranked.filter((item) => !item.track.linked_release_id);
  const topCandidate = unreleased.find((item) => item.eligible) ?? unreleased[0] ?? null;
  const remaining = topCandidate
    ? unreleased.filter((item) => item.track.id !== topCandidate.track.id)
    : unreleased;
  const analyzedCount = unreleased.filter((item) => hasMusicMap(item.track)).length;
  const masteredCount = unreleased.filter((item) => Boolean(item.track.audio_url)).length;
  const trackCountByRelease = new Map<string, number>();
  for (const track of tracks) {
    trackCountByRelease.set(track.release_id, (trackCountByRelease.get(track.release_id) ?? 0) + 1);
  }
  const portfolioHref = `${ensemblisArtistHref("/studio/growth?view=portfolio", artistId)}#vault`;
  const createHref = ensemblisArtistHref("/studio/music?view=generate", artistId);
  const trackHref = (trackId: string) => ensemblisArtistHref(`/studio/music/${trackId}`, artistId);

  return (
    <div className="music-workspace-overview">
      <section className="music-workspace-summary" aria-label={`${artistName} music summary`}>
        <div><strong>{unreleased.length}</strong><span>unreleased</span></div>
        <div><strong>{masteredCount}</strong><span>masters ready</span></div>
        <div><strong>{analyzedCount}</strong><span>analyzed</span></div>
        <div><strong>{tracks.length}</strong><span>catalog tracks</span></div>
      </section>

      <div className="music-workspace-focus-grid">
        <section className="v2-section music-workspace-focus">
          <div className="v2-section-heading">
            <div>
              <span className="section-label">Next track decision</span>
              <h2>{topCandidate ? topCandidate.track.title : "Add the music Ensemblis should understand"}</h2>
            </div>
            {topCandidate ? (
              <span className={`music-score${topCandidate.eligible ? "" : " is-blocked"}`}>
                {topCandidate.eligible ? Math.round(topCandidate.score) : "Hold"}
              </span>
            ) : null}
          </div>

          {topCandidate ? (
            <>
              <div className="music-track-meta-line">
                <span>{titleCase(topCandidate.track.status)}</span>
                <span>{analysisLabel(topCandidate.track)}</span>
                {topCandidate.track.version ? <span>{topCandidate.track.version}</span> : null}
              </div>
              <p className="v2-muted-copy">
                {topCandidate.blocker || `Strongest current portfolio candidate because of ${topCandidate.reasons.join(", ")}.`}
              </p>
              {topCandidate.track.audio_url ? (
                <audio className="music-workspace-audio" controls preload="metadata" src={topCandidate.track.audio_url} />
              ) : null}
              {hasMusicMap(topCandidate.track) ? (
                <MusicIntelligencePreview
                  audioUrl={topCandidate.track.audio_url}
                  musicMap={topCandidate.track.audio_profile}
                />
              ) : (
                <div className="v2-calm-state compact">
                  <strong>{topCandidate.track.audio_url ? "Master ready for intelligence." : "No master attached yet."}</strong>
                  <p>{topCandidate.track.audio_url ? "Open the track to inspect source context and manage its release decision." : "Attach the canonical master in Portfolio so Ensemblis can map structure, hooks and creative moments."}</p>
                </div>
              )}
              <div className="actions">
                <Link className="button primary" href={trackHref(topCandidate.track.id)}>Open track</Link>
                <Link className="button" href={portfolioHref}>Edit portfolio signals</Link>
              </div>
            </>
          ) : (
            <div className="v2-calm-state compact">
              <strong>No unreleased tracks are waiting for a decision.</strong>
              <p>Generate a draft or add a mastered track. Ensemblis will keep source audio, intelligence and release decisions connected.</p>
              <Link className="button primary" href={createHref}>Create music</Link>
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
            <h2>{remaining.length ? `${remaining.length} more track${remaining.length === 1 ? "" : "s"}` : topCandidate ? "Portfolio is focused" : "Your unreleased vault"}</h2>
          </div>
          <Link href={portfolioHref}>Manage Portfolio</Link>
        </div>
        {remaining.length ? (
          <div className="music-track-list">
            {remaining.map((item, index) => (
              <div className="music-track-row" key={item.track.id}>
                <span className="music-track-rank">{String(index + 2).padStart(2, "0")}</span>
                <span className="music-track-copy">
                  <strong>{item.track.title}</strong>
                  <small>{titleCase(item.track.status)} · {analysisLabel(item.track)}{item.track.version ? ` · ${item.track.version}` : ""}</small>
                </span>
                {item.track.audio_url ? <audio controls preload="metadata" src={item.track.audio_url} /> : <span className="music-track-missing">No master</span>}
                <span className={`music-score small${item.eligible ? "" : " is-blocked"}`}>{item.eligible ? Math.round(item.score) : "Hold"}</span>
                <Link className="music-row-link" href={trackHref(item.track.id)}>Open →</Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="v2-calm-state compact inline">
            <strong>{topCandidate ? "One clear unreleased priority." : "Nothing is waiting in the Vault."}</strong>
            <p>{topCandidate ? "Keep the decision surface focused instead of manufacturing extra portfolio work." : "Add or generate music when there is a real track to develop."}</p>
          </div>
        )}
      </section>

      <section className="music-workspace-create-callout">
        <div>
          <span className="section-label">New music</span>
          <h2>Start from an idea, not provider settings.</h2>
          <p>Ensemblis chooses a sensible generation path first. Model, duration, prompt and other controls stay available when you need them.</p>
        </div>
        <Link className="button primary" href={createHref}>Create track</Link>
      </section>
    </div>
  );
}
