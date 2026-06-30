import Link from "next/link";
import {
  dismissSoundCloudTrack,
  linkExternalSoundCloudTrack,
} from "@/app/studio/catalog-actions";
import {
  disconnectSoundCloudAccount,
  importSoundCloudTrack,
  syncSoundCloud,
  syncSoundCloudMetrics,
  uploadTrackToSoundCloud,
} from "@/app/studio/actions";
import {
  EmptyState,
  Field,
  FormatTime,
  PageHeader,
  Panel,
  Status,
  Submit,
} from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { hasSoundCloudEnv } from "@/lib/studio/soundcloud";
import { isUnmatchedExternal, suggestTrackMatches } from "@/lib/studio/reconciliation";

export default async function SoundCloudPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    synced?: string;
    uploaded?: string;
    metrics?: string;
    disconnected?: string;
    linked?: string;
    error?: string;
  }>;
}) {
  const { supabase, user } = await requireStudioAdmin();
  const params = await searchParams;
  const configured = hasSoundCloudEnv();
  const [{ data: account }, { data: tracks }, { data: playlists }, { data: releases }] =
    await Promise.all([
      supabase.from("soundcloud_accounts").select("*").maybeSingle(),
      supabase
        .from("soundcloud_tracks")
        .select("*")
        .order("synced_at", { ascending: false }),
      supabase
        .from("soundcloud_playlists")
        .select("*")
        .order("synced_at", { ascending: false }),
      supabase.from("releases").select("id,title"),
    ]);

  const releaseById = new Map((releases ?? []).map((release) => [release.id, release]));
  const unmatched = (tracks ?? []).filter(isUnmatchedExternal);
  const statusMessage =
    (params.connected && "SoundCloud connected.") ||
    (params.synced && "SoundCloud catalog synced.") ||
    (params.uploaded && "Track uploaded to SoundCloud.") ||
    (params.metrics && "SoundCloud metric snapshots synced.") ||
    (params.disconnected && "SoundCloud disconnected.") ||
    (params.linked && "SoundCloud track linked.") ||
    (params.error && `SoundCloud error: ${params.error.replaceAll("_", " ")}`);

  return (
    <>
      <PageHeader
        title="Connections · SoundCloud"
        description="Sync external catalog data, reconcile unmatched tracks, and push metrics into Insights."
      />
      {statusMessage && (
        <div className={params.error ? "auth-message form-error" : "auth-message"}>
          {statusMessage}
        </div>
      )}
      {!configured && (
        <Panel title="Configuration required" className="feature">
          <p>
            Add SoundCloud OAuth env vars and register `/studio/soundcloud/callback`.
          </p>
        </Panel>
      )}
      {configured && account ? (
        <>
          <div className="studio-grid">
            <Panel title="Connected account" className="feature">
              <h2>{account.username}</h2>
              <small>
                Last synced:{" "}
                {account.last_synced_at
                  ? new Date(account.last_synced_at).toLocaleString()
                  : "Not synced yet"}
              </small>
              <div className="form-actions">
                <form action={syncSoundCloud}>
                  <Submit>Sync catalog</Submit>
                </form>
                <form action={syncSoundCloudMetrics}>
                  <button className="button">Sync metrics</button>
                </form>
                <form action={disconnectSoundCloudAccount}>
                  <button className="text-button">Disconnect</button>
                </form>
              </div>
            </Panel>
            <Panel title="Reconciliation queue">
              <div className="metric-row">
                <span>Unmatched tracks</span>
                <strong>{unmatched.length}</strong>
              </div>
              <div className="metric-row">
                <span>Linked tracks</span>
                <strong>{(tracks ?? []).filter((track) => track.linked_track_id).length}</strong>
              </div>
            </Panel>
          </div>

          <Panel title="Unmatched external tracks" className="feature">
            {unmatched.length ? (
              <table className="studio-table">
                <thead>
                  <tr>
                    <th>Track</th>
                    <th>Suggested matches</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {await Promise.all(
                    unmatched.slice(0, 12).map(async (track) => {
                      const suggestions = await suggestTrackMatches(supabase, user.id, {
                        title: track.title,
                        durationSeconds: track.duration
                          ? Math.round(track.duration / 1000)
                          : null,
                      });
                      return (
                        <tr key={track.id}>
                          <td>
                            <strong>{track.title}</strong>
                            <br />
                            <small>{track.permalink_url}</small>
                          </td>
                          <td>
                            {suggestions.length ? (
                              suggestions.map((match) => (
                                <form action={linkExternalSoundCloudTrack} key={match.trackId}>
                                  <input type="hidden" name="external_id" value={track.id} />
                                  <input type="hidden" name="track_id" value={match.trackId} />
                                  <button className="text-button">
                                    Link to {match.trackTitle} ({match.score})
                                  </button>
                                </form>
                              ))
                            ) : (
                              "No confident matches"
                            )}
                          </td>
                          <td>
                            <form action={importSoundCloudTrack}>
                              <input type="hidden" name="id" value={track.id} />
                              <button className="text-button">Create release</button>
                            </form>
                            <form action={dismissSoundCloudTrack}>
                              <input type="hidden" name="id" value={track.id} />
                              <button className="text-button">Dismiss</button>
                            </form>
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            ) : (
              <EmptyState title="All synced tracks are reconciled" body="New SoundCloud uploads will appear here until linked." />
            )}
          </Panel>

          <Panel title="Synced tracks" className="feature">
            {tracks?.length ? (
              <table className="studio-table">
                <thead>
                  <tr>
                    <th>Track</th>
                    <th>Duration</th>
                    <th>Plays</th>
                    <th>Studio link</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((track) => {
                    const linkedRelease = track.linked_release_id
                      ? releaseById.get(track.linked_release_id)
                      : null;
                    return (
                      <tr key={track.id}>
                        <td>
                          <a href={track.permalink_url} target="_blank" rel="noreferrer">
                            <strong>{track.title}</strong>
                          </a>
                        </td>
                        <td>
                          <FormatTime
                            seconds={
                              track.duration ? Math.round(track.duration / 1000) : null
                            }
                          />
                        </td>
                        <td>{track.playback_count.toLocaleString()}</td>
                        <td>
                          {linkedRelease ? (
                            <Link href={`/studio/releases/${linkedRelease.id}`}>
                              <Status>{linkedRelease.title}</Status>
                            </Link>
                          ) : track.reconcile_status === "dismissed" ? (
                            "Dismissed"
                          ) : (
                            "Unmatched"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState title="No SoundCloud tracks synced" body="Run a catalog sync to pull tracks." />
            )}
          </Panel>

          <Panel title="Upload to SoundCloud" className="feature">
            <form action={uploadTrackToSoundCloud} className="studio-form">
              <div className="form-grid">
                <Field label="Title"><input name="title" required /></Field>
                <Field label="Audio file"><input name="audio" type="file" accept="audio/*" required /></Field>
                <Field label="Description" wide><textarea name="description" rows={4} /></Field>
              </div>
              <Submit>Upload track</Submit>
            </form>
          </Panel>

          <Panel title="Playlists" className="feature">
            {playlists?.length ? (
              <table className="studio-table">
                <tbody>
                  {playlists.map((playlist) => (
                    <tr key={playlist.id}>
                      <td>
                        <a href={playlist.permalink_url} target="_blank" rel="noreferrer">
                          {playlist.title}
                        </a>
                      </td>
                      <td>{playlist.track_count} tracks</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState title="No playlists synced" body="Playlists appear after sync." />
            )}
          </Panel>
        </>
      ) : configured ? (
        <Panel title="Connect SoundCloud" className="feature">
          <a className="button primary" href="/studio/soundcloud/connect">
            Connect SoundCloud
          </a>
        </Panel>
      ) : null}
    </>
  );
}
