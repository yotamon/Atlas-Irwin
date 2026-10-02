import Link from "next/link";
import { Status } from "@/components/studio/ui";
import { TrackPreview } from "@/components/studio/track-preview";
import { ContinueWidget } from "@/components/studio/ux-v4-widgets";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { describeMusicIngestionProgress } from "@/lib/studio/track-analysis-state";
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
  version: string | null;
  release_id: string;
  audio_url: string | null;
  is_primary: boolean;
  track_number: number | null;
  display_order: number;
};

function ingestionProgress(track: VaultTrack) {
  return describeMusicIngestionProgress({
    hasMaster: Boolean(track.audio_url),
    analysisValue: track.analysis,
    musicMapValue: track.audio_profile,
    releaseBound: Boolean(track.linked_track_id || track.linked_release_id),
  });
}

function normalized(value: string) {
  return value.trim().toLowerCase();
}

export function MusicWorkspaceOverview({
  artistId,
  artistName,
  vaultTracks,
  releases,
  tracks,
  query = "",
}: {
  artistId: string;
  artistName: string;
  vaultTracks: VaultTrack[];
  releases: ReleaseSummary[];
  tracks: TrackSummary[];
  query?: string;
}) {
  const href = (path: string) => ensemblisArtistHref(path, artistId);
  const releaseById = new Map(releases.map((release) => [release.id, release]));
  const vaultByTrack = new Map(
    vaultTracks
      .filter((track) => track.linked_track_id)
      .map((track) => [track.linked_track_id as string, track]),
  );
  const q = normalized(query);

  const unreleased = vaultTracks.filter((track) => !track.linked_release_id);
  const attention = unreleased
    .map((track) => ({ track, progress: ingestionProgress(track) }))
    .filter(({ track, progress }) => !track.audio_url || progress.phase === "needs_attention" || progress.phase === "needs_input")
    .slice(0, 3);

  const catalogRows = tracks.map((track) => {
      const vault = vaultByTrack.get(track.id) ?? null;
      const release = releaseById.get(track.release_id);
      const audioUrl = vault?.audio_url || track.audio_url;
      const progress = vault ? ingestionProgress(vault) : null;
      return {
        key: `catalog:${track.id}`,
        title: track.title,
        version: track.version,
        releaseTitle: release?.title ?? "Release",
        audioUrl,
        state: progress?.label ?? (audioUrl ? "Master ready" : "Needs master"),
        stateTone: !audioUrl || progress?.phase === "needs_attention" ? "attention" as const : "success" as const,
        detail: progress?.detail ?? (audioUrl ? "Ready to use across Ensemblis." : "Add the canonical master to continue."),
        href: href(`/studio/music/${vault?.id ?? track.id}`),
      };
    })
    .filter((row) => !q || normalized(`${row.title} ${row.releaseTitle} ${row.version ?? ""}`).includes(q));

  const unreleasedRows = unreleased
    .map((track) => {
      const progress = ingestionProgress(track);
      return {
        key: `vault:${track.id}`,
        title: track.title,
        version: track.version,
        releaseTitle: "Unreleased",
        audioUrl: track.audio_url,
        state: progress.label,
        stateTone: !track.audio_url || progress.phase === "needs_attention" ? "attention" as const : progress.phase === "ready" ? "success" as const : "neutral" as const,
        detail: progress.detail,
        href: href(`/studio/music/${track.id}`),
      };
    })
    .filter((row) => !q || normalized(`${row.title} ${row.version ?? ""}`).includes(q));

  const rows = [...unreleasedRows, ...catalogRows];

  return (
    <div className="music-v5-library">
      {attention.length ? (
        <section className="music-v5-continue" aria-labelledby="music-needs-attention">
          <div className="v2-section-heading compact">
            <div>
              <span className="section-label">Continue</span>
              <h2 id="music-needs-attention">Music that needs your attention</h2>
            </div>
          </div>
          <div className="en-continue-grid">
            {attention.map(({ track, progress }) => (
              <ContinueWidget
                key={track.id}
                eyebrow="Track"
                title={track.title}
                detail={progress.detail}
                status={progress.label}
                tone={progress.phase === "needs_attention" ? "danger" : "attention"}
                href={href(`/studio/music/${track.id}`)}
                actionLabel="Open"
              />
            ))}
          </div>
        </section>
      ) : null}

      <form className="music-v5-search" action="/studio/music">
        <input type="hidden" name="artist" value={artistId} />
        <label>
          <span className="sr-only">Search music</span>
          <input
            type="search"
            name="q"
            placeholder={`Search ${artistName}'s tracks…`}
            defaultValue={query}
            autoComplete="off"
          />
        </label>
        <button className="button" type="submit">Search</button>
        {query ? <Link className="text-button" href={href("/studio/music")}>Clear</Link> : null}
      </form>

      <section className="v2-section music-v5-track-collection" aria-labelledby="music-tracks-heading">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Tracks</span>
            <h2 id="music-tracks-heading">{query ? `Results for “${query}”` : "Your music"}</h2>
            <p>{query ? `${rows.length} matching track${rows.length === 1 ? "" : "s"}.` : "Open a song to play it, understand its state and choose what to do next."}</p>
          </div>
          <Link className="button primary" href={href("/studio/music?view=add")}>Add music</Link>
        </div>

        {rows.length ? (
          <div className="music-v5-track-list">
            {rows.map((row) => (
              <article className="music-v5-track-row" key={row.key}>
                <div className="music-v5-track-identity">
                  <small>{row.releaseTitle}</small>
                  <strong>{row.title}{row.version ? ` · ${row.version}` : ""}</strong>
                  <span>{row.detail}</span>
                </div>
                {row.audioUrl ? <TrackPreview src={row.audioUrl} label={row.title} compact /> : <span className="music-track-missing">No master</span>}
                <Status tone={row.stateTone}>{row.state}</Status>
                <Link className="button" href={row.href}>Open</Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="v2-calm-state compact">
            <strong>{query ? "No matching tracks." : "No music yet."}</strong>
            <p>{query ? "Try a different title, or clear the search." : "Add a mastered track and Ensemblis will start understanding it automatically."}</p>
            {query ? <Link className="button" href={href("/studio/music")}>Clear search</Link> : <Link className="button primary" href={href("/studio/music?view=add")}>Add music</Link>}
          </div>
        )}
      </section>
    </div>
  );
}
