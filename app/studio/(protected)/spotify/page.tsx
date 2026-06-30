import Link from "next/link";
import {
  createCampaignPlaylist,
  disconnectSpotifyAccount,
  importSpotifyAlbum,
  saveSpotifyArtist,
  syncSpotifyCatalog,
} from "@/app/studio/actions";
import { EmptyState, Field, FormatTime, PageHeader, Panel, Status, Submit } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { hasSpotifyEnv } from "@/lib/studio/spotify";

type PulseItem = {
  id?: string;
  name?: string;
  external_urls?: { spotify?: string };
  artists?: Array<{ name?: string }>;
};

function pulseItems(value: unknown): PulseItem[] {
  return Array.isArray(value) ? (value as PulseItem[]) : [];
}

export default async function SpotifyPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    artist?: string;
    synced?: string;
    playlist?: string;
    disconnected?: string;
    error?: string;
  }>;
}) {
  const { supabase } = await requireStudioAdmin();
  const params = await searchParams;
  const configured = hasSpotifyEnv();
  const [{ data: account }, { data: albums }, { data: tracks }, { data: playlists }, { data: releases }] =
    await Promise.all([
      supabase.from("spotify_accounts").select("*").maybeSingle(),
      supabase.from("spotify_albums").select("*").order("release_date", { ascending: false }),
      supabase.from("spotify_tracks").select("*").order("album_spotify_id").order("disc_number").order("track_number"),
      supabase.from("spotify_playlists").select("*").order("synced_at", { ascending: false }),
      supabase.from("releases").select("id,title,spotify_url"),
    ]);
  const releaseBySpotifyUrl = new Map(
    (releases ?? []).filter((release) => release.spotify_url).map((release) => [release.spotify_url, release]),
  );
  const topArtists = pulseItems(account?.top_artists);
  const topTracks = pulseItems(account?.top_tracks);
  const errorMessages: Record<string, string> = {
    premium_required: "Spotify Premium is required to connect. Upgrade your Spotify account, then try again.",
    missing_spotify_env: "Spotify client credentials are not configured.",
    missing_service_role_key: "SUPABASE_SERVICE_ROLE_KEY is not set.",
    spotify_migration_missing: "Spotify database tables are missing. Push the latest migration.",
    token_exchange_failed: "Spotify token exchange failed. Check the client ID and secret.",
    profile_fetch_failed: "Could not fetch your Spotify profile.",
    no_refresh_token: "Spotify did not return a refresh token. Re-authorize the app.",
    token_expired: "Spotify authorization has expired. Reconnect.",
    invalid_oauth_state: "OAuth state mismatch. Please try connecting again.",
    spotify_api_error: "Spotify API error. Check Vercel function logs for details.",
    connection_failed: "Spotify connection failed. Check Vercel function logs for details.",
  };
  const statusMessage =
    (params.connected && "Spotify connected. Add your artist profile, then run the first sync.") ||
    (params.artist && "Spotify artist profile verified.") ||
    (params.synced && "Spotify catalog, account pulse, and playlists synced.") ||
    (params.playlist && `Campaign playlist "${params.playlist}" created on Spotify.`) ||
    (params.disconnected && "Spotify disconnected.") ||
    (params.error && (errorMessages[params.error] ?? `Spotify error: ${params.error.replaceAll("_", " ")}`));

  return (
    <>
      <PageHeader
        title="Spotify"
        description="Artist catalog, release imports, listener pulse, and campaign playlists through Spotify Web API."
        action={
          configured && !account ? (
            <a className="button primary" href="/studio/spotify/connect">Connect Spotify</a>
          ) : null
        }
      />
      {statusMessage && (
        <div className={params.error ? "auth-message form-error" : "auth-message"}>{statusMessage}</div>
      )}
      {!configured && (
        <Panel title="Configuration required" className="feature">
          <p>
            Add <code>SPOTIFY_CLIENT_ID</code> and <code>SPOTIFY_CLIENT_SECRET</code>, then register the exact
            redirect URI <code>/studio/spotify/callback</code> in your Spotify app.
          </p>
        </Panel>
      )}
      {configured && account ? (
        <>
          <div className="studio-grid">
            <Panel title="Connected account" className="feature">
              <div className="soundcloud-profile">
                {account.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="spotify-artwork" src={account.image_url} alt="" />
                ) : (
                  <div className="empty-orbit" />
                )}
                <div>
                  <h2>{account.display_name}</h2>
                  <p>
                    {account.profile_url ? <a href={account.profile_url} target="_blank" rel="noreferrer">Open on Spotify</a> : "Spotify account"}
                  </p>
                  <small>Last synced: {account.last_synced_at ? new Date(account.last_synced_at).toLocaleString() : "Not synced yet"}</small>
                </div>
              </div>
              <div className="form-actions">
                {account.artist_id ? (
                  <form action={syncSpotifyCatalog}><Submit>Sync Spotify</Submit></form>
                ) : null}
                <form action={disconnectSpotifyAccount}><button className="text-button">Disconnect</button></form>
              </div>
            </Panel>
            <Panel title="API coverage">
              <div className="metric-row"><span>Catalog releases</span><strong>{albums?.length ?? 0}</strong></div>
              <div className="metric-row"><span>Catalog tracks</span><strong>{tracks?.length ?? 0}</strong></div>
              <div className="metric-row"><span>Account playlists</span><strong>{playlists?.length ?? 0}</strong></div>
              <div className="metric-row"><span>Imported releases</span><strong>{(albums ?? []).filter((album) => releaseBySpotifyUrl.has(album.spotify_url)).length}</strong></div>
            </Panel>
          </div>

          <Panel title="Atlas Irwin artist profile" className="feature">
            {account.artist_id ? (
              <div className="soundcloud-profile">
                {account.artist_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="spotify-artwork" src={account.artist_image_url} alt="" />
                ) : <div className="empty-orbit" />}
                <div>
                  <h2>{account.artist_name}</h2>
                  <p><a href={account.artist_url ?? `https://open.spotify.com/artist/${account.artist_id}`} target="_blank" rel="noreferrer">Verified Spotify artist source</a></p>
                  <small>Artist ID: {account.artist_id}</small>
                </div>
              </div>
            ) : (
              <p>Paste the Atlas Irwin artist link from Spotify. Studio verifies it against the API before saving it.</p>
            )}
            <form action={saveSpotifyArtist} className="studio-form compact-form">
              <Field label="Spotify artist URL, URI, or ID">
                <input name="artist" defaultValue={account.artist_url ?? account.artist_id ?? ""} required />
              </Field>
              <Submit>{account.artist_id ? "Change artist" : "Verify artist"}</Submit>
            </form>
          </Panel>

          <Panel title="Spotify releases" className="feature">
            {albums?.length ? (
              <table className="studio-table">
                <thead><tr><th>Release</th><th>Type</th><th>Date</th><th>Tracks</th><th>Studio release</th><th></th></tr></thead>
                <tbody>
                  {albums.map((album) => {
                    const release = releaseBySpotifyUrl.get(album.spotify_url);
                    return (
                      <tr key={album.id}>
                        <td><a href={album.spotify_url} target="_blank" rel="noreferrer"><strong>{album.name}</strong></a></td>
                        <td>{album.album_type}</td>
                        <td>{album.release_date ?? "—"}</td>
                        <td>{album.total_tracks}</td>
                        <td>{release ? <Link href={`/studio/releases/${release.id}`}><Status>{release.title}</Status></Link> : "Not imported"}</td>
                        <td>{release ? null : <form action={importSpotifyAlbum}><input type="hidden" name="id" value={album.id} /><button className="text-button">Import release</button></form>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState title="No Spotify catalog synced" body="Verify the artist profile, then sync to pull releases and tracks into Studio." />
            )}
          </Panel>

          {tracks?.length ? (
            <Panel title="Create a campaign playlist" className="feature">
              <p>Create a deliberate Spotify playlist from synced Atlas tracks. Nothing is published until you submit this form.</p>
              <form action={createCampaignPlaylist} className="studio-form">
                <div className="form-grid">
                  <Field label="Playlist name"><input name="name" required /></Field>
                  <Field label="Visibility"><select name="visibility" defaultValue="private"><option value="private">Private</option><option value="public">Public</option></select></Field>
                  <Field label="Description" wide><textarea name="description" rows={3} maxLength={300} /></Field>
                </div>
                <div className="spotify-track-picker">
                  {tracks.map((track) => (
                    <label key={track.id}>
                      <input type="checkbox" name="track_id" value={track.id} />
                      <span>{track.name}</span>
                      <small><FormatTime seconds={Math.round(track.duration_ms / 1000)} />{track.isrc ? ` · ${track.isrc}` : ""}</small>
                    </label>
                  ))}
                </div>
                <div className="form-actions"><Submit>Create on Spotify</Submit></div>
              </form>
            </Panel>
          ) : null}

          <div className="studio-grid">
            <Panel title="Your listening pulse" className="feature">
              <p><small>Medium-term affinity from the connected Spotify account—not Spotify for Artists audience analytics.</small></p>
              <div className="spotify-pulse-grid">
                <div><h3>Top artists</h3>{topArtists.map((item, index) => <a key={item.id ?? index} href={item.external_urls?.spotify} target="_blank" rel="noreferrer"><span>{index + 1}</span>{item.name}</a>)}</div>
                <div><h3>Top tracks</h3>{topTracks.map((item, index) => <a key={item.id ?? index} href={item.external_urls?.spotify} target="_blank" rel="noreferrer"><span>{index + 1}</span><span>{item.name}<small>{item.artists?.map((artist) => artist.name).filter(Boolean).join(", ")}</small></span></a>)}</div>
              </div>
            </Panel>
            <Panel title="Connected playlists">
              {(playlists ?? []).slice(0, 8).map((playlist) => (
                <a className="list-row" href={playlist.spotify_url} target="_blank" rel="noreferrer" key={playlist.id}>
                  <span>{playlist.name}<small>{playlist.is_public ? "Public" : "Private"}</small></span><strong>{playlist.item_count}</strong>
                </a>
              ))}
              {!playlists?.length ? <p>No playlists synced yet.</p> : null}
            </Panel>
          </div>
          <p className="spotify-attribution">Metadata and links provided by Spotify. Spotify for Artists metrics remain available only in Spotify for Artists.</p>
        </>
      ) : configured ? (
        <Panel title="Connect Spotify" className="feature">
          <EmptyState title="Spotify is ready to connect" body="Authorize the Studio account to read your profile and playlists, sync the Atlas catalog, and create campaign playlists." />
          <div className="form-actions"><a className="button primary" href="/studio/spotify/connect">Connect Spotify</a></div>
        </Panel>
      ) : null}
    </>
  );
}
