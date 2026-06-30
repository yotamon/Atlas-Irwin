import Link from "next/link";
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

export default async function SoundCloudPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    synced?: string;
    uploaded?: string;
    metrics?: string;
    disconnected?: string;
    error?: string;
  }>;
}) {
  const { supabase } = await requireStudioAdmin();
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
      supabase.from("releases").select("id,title,soundcloud_url"),
    ]);
  const releaseBySoundCloudUrl = new Map(
    (releases ?? [])
      .filter((release) => release.soundcloud_url)
      .map((release) => [release.soundcloud_url, release]),
  );
  const statusMessage =
    (params.connected && "SoundCloud connected.") ||
    (params.synced && "SoundCloud catalog synced.") ||
    (params.uploaded && "Track uploaded to SoundCloud and added to the synced catalog.") ||
    (params.metrics && "SoundCloud metric snapshots synced.") ||
    (params.disconnected && "SoundCloud disconnected.") ||
    (params.error && `SoundCloud error: ${params.error.replaceAll("_", " ")}`);

  return (
    <>
      <PageHeader
        title="SoundCloud"
        description="OAuth, catalog sync, uploads, release imports, and metrics from SoundCloud."
        action={
          configured && !account ? (
            <Link className="button primary" href="/studio/soundcloud/connect">
              Connect SoundCloud
            </Link>
          ) : null
        }
      />
      {statusMessage && (
        <div className={params.error ? "auth-message form-error" : "auth-message"}>
          {statusMessage}
        </div>
      )}
      {!configured && (
        <Panel title="Configuration required" className="feature">
          <p>
            Add <code>SOUNDCLOUD_CLIENT_ID</code> and{" "}
            <code>SOUNDCLOUD_CLIENT_SECRET</code>, then register{" "}
            <code>/studio/soundcloud/callback</code> in the SoundCloud developer
            app.
          </p>
        </Panel>
      )}
      {configured && account ? (
        <>
          <div className="studio-grid">
            <Panel title="Connected account" className="feature">
              <div className="soundcloud-profile">
                {account.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={account.avatar_url} alt="" />
                ) : (
                  <div className="empty-orbit" />
                )}
                <div>
                  <h2>{account.username}</h2>
                  <p>
                    {account.permalink_url ? (
                      <a href={account.permalink_url} target="_blank" rel="noreferrer">
                        {account.permalink_url}
                      </a>
                    ) : (
                      "Connected to SoundCloud"
                    )}
                  </p>
                  <small>
                    Last synced:{" "}
                    {account.last_synced_at
                      ? new Date(account.last_synced_at).toLocaleString()
                      : "Not synced yet"}
                  </small>
                </div>
              </div>
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
            <Panel title="API coverage">
              <div className="metric-row">
                <span>Synced tracks</span>
                <strong>{tracks?.length ?? 0}</strong>
              </div>
              <div className="metric-row">
                <span>Synced playlists</span>
                <strong>{playlists?.length ?? 0}</strong>
              </div>
              <div className="metric-row">
                <span>Imported releases</span>
                <strong>
                  {(tracks ?? []).filter((track) =>
                    releaseBySoundCloudUrl.has(track.permalink_url),
                  ).length}
                </strong>
              </div>
            </Panel>
          </div>
          <Panel title="Upload to SoundCloud" className="feature">
            <form action={uploadTrackToSoundCloud} className="studio-form">
              <div className="form-grid">
                <Field label="Title">
                  <input name="title" required />
                </Field>
                <Field label="Audio file">
                  <input name="audio" type="file" accept="audio/*" required />
                </Field>
                <Field label="Genre">
                  <input name="genre" />
                </Field>
                <Field label="Visibility">
                  <select name="sharing" defaultValue="private">
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                  </select>
                </Field>
                <Field label="Description" wide>
                  <textarea name="description" rows={4} />
                </Field>
              </div>
              <div className="form-actions">
                <Submit>Upload track</Submit>
              </div>
            </form>
          </Panel>
          <Panel title="Tracks" className="feature">
            {tracks?.length ? (
              <table className="studio-table">
                <thead>
                  <tr>
                    <th>Track</th>
                    <th>Duration</th>
                    <th>Plays</th>
                    <th>Likes</th>
                    <th>Comments</th>
                    <th>Reposts</th>
                    <th>Studio release</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((track) => {
                    const release = releaseBySoundCloudUrl.get(track.permalink_url);
                    return (
                      <tr key={track.id}>
                        <td>
                          <a href={track.permalink_url} target="_blank" rel="noreferrer">
                            <strong>{track.title}</strong>
                          </a>
                          <br />
                          <small>{track.genre || "No genre"}</small>
                        </td>
                        <td>
                          <FormatTime
                            seconds={
                              track.duration ? Math.round(track.duration / 1000) : null
                            }
                          />
                        </td>
                        <td>{track.playback_count.toLocaleString()}</td>
                        <td>{track.favoritings_count.toLocaleString()}</td>
                        <td>{track.comment_count.toLocaleString()}</td>
                        <td>{track.reposts_count.toLocaleString()}</td>
                        <td>
                          {release ? (
                            <Link href={`/studio/releases/${release.id}`}>
                              <Status>{release.title}</Status>
                            </Link>
                          ) : (
                            "Not imported"
                          )}
                        </td>
                        <td>
                          {release ? null : (
                            <form action={importSoundCloudTrack}>
                              <input type="hidden" name="id" value={track.id} />
                              <button className="text-button">Import</button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="No SoundCloud tracks synced"
                body="Sync your catalog to pull your SoundCloud tracks into Studio."
              />
            )}
          </Panel>
          <Panel title="Playlists" className="feature">
            {playlists?.length ? (
              <table className="studio-table">
                <thead>
                  <tr>
                    <th>Playlist</th>
                    <th>Tracks</th>
                    <th>Duration</th>
                    <th>Genre</th>
                  </tr>
                </thead>
                <tbody>
                  {playlists.map((playlist) => (
                    <tr key={playlist.id}>
                      <td>
                        <a href={playlist.permalink_url} target="_blank" rel="noreferrer">
                          <strong>{playlist.title}</strong>
                        </a>
                      </td>
                      <td>{playlist.track_count}</td>
                      <td>
                        <FormatTime
                          seconds={
                            playlist.duration
                              ? Math.round(playlist.duration / 1000)
                              : null
                          }
                        />
                      </td>
                      <td>{playlist.genre || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="No SoundCloud playlists synced"
                body="Playlists appear here after the first catalog sync."
              />
            )}
          </Panel>
        </>
      ) : configured ? (
        <Panel title="Connect SoundCloud" className="feature">
          <EmptyState
            title="SoundCloud is ready to connect"
            body="Authorize Studio to read your catalog, upload tracks, and turn SoundCloud counts into metric snapshots."
            href="/studio/soundcloud/connect"
            label="Connect SoundCloud"
          />
        </Panel>
      ) : null}
    </>
  );
}
