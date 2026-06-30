import { createHash, randomBytes } from "crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/config";
import type { Database, Json } from "@/types/database";

const API_BASE_URL = "https://api.spotify.com/v1";
const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const SCOPES = [
  "user-read-private",
  "user-top-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
].join(" ");

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

type SpotifyImage = { url: string; height?: number | null; width?: number | null };
type SpotifyExternalUrls = { spotify?: string };

export type SpotifyProfile = {
  account_id?: string;
  id?: string;
  display_name?: string | null;
  external_urls?: SpotifyExternalUrls;
  images?: SpotifyImage[];
};

export type SpotifyArtist = {
  id: string;
  name: string;
  uri: string;
  external_urls?: SpotifyExternalUrls;
  images?: SpotifyImage[];
  genres?: string[];
};

export type SpotifyAlbum = {
  id: string;
  name: string;
  album_type: string;
  total_tracks: number;
  release_date: string;
  release_date_precision: string;
  uri: string;
  external_urls?: SpotifyExternalUrls;
  images?: SpotifyImage[];
  artists?: Array<Pick<SpotifyArtist, "id" | "name" | "uri">>;
};

export type SpotifyTrack = {
  id: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  disc_number: number;
  track_number: number;
  uri: string;
  external_urls?: SpotifyExternalUrls;
  external_ids?: { isrc?: string };
  artists?: Array<Pick<SpotifyArtist, "id" | "name" | "uri">>;
  album?: SpotifyAlbum;
};

type SpotifyPlaylist = {
  id: string;
  name: string;
  description?: string | null;
  public?: boolean | null;
  collaborative?: boolean;
  uri: string;
  external_urls?: SpotifyExternalUrls;
  images?: SpotifyImage[];
  owner?: { display_name?: string | null };
  items?: { total?: number };
  tracks?: { total?: number };
};

type Page<T> = {
  items: T[];
  next?: string | null;
  total?: number;
};

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

function spotifyClientEnv() {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Spotify client environment variables are missing.");
  }
  return { clientId, clientSecret };
}

function serviceSupabase() {
  const { url } = getSupabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for Spotify token storage.");
  }
  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function base64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function redirectUri(origin: string) {
  return (
    process.env.SPOTIFY_REDIRECT_URI?.trim() ||
    `${origin.replace(/\/$/, "")}/studio/spotify/callback`
  );
}

export function hasSpotifyEnv() {
  return Boolean(
    process.env.SPOTIFY_CLIENT_ID?.trim() &&
      process.env.SPOTIFY_CLIENT_SECRET?.trim(),
  );
}

export function createSpotifyAuthorizeUrl(origin: string) {
  const { clientId } = spotifyClientEnv();
  const state = base64Url(randomBytes(32));
  const codeVerifier = base64Url(randomBytes(64));
  const codeChallenge = base64Url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri(origin));
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", codeChallenge);
  return { url, state, codeVerifier };
}

async function exchangeToken(body: URLSearchParams) {
  const { clientId, clientSecret } = spotifyClientEnv();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new SpotifyApiError(
      `Spotify token exchange failed (${response.status}).`,
      response.status,
    );
  }
  return (await response.json()) as TokenResponse;
}

async function storeToken(
  ownerId: string,
  token: TokenResponse & { refresh_token: string },
) {
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  const { error } = await serviceSupabase().rpc("upsert_spotify_token", {
    p_owner_id: ownerId,
    p_access_token: token.access_token,
    p_refresh_token: token.refresh_token,
    p_scope: token.scope ?? null,
    p_expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);
}

export async function completeSpotifyOAuth({
  code,
  codeVerifier,
  origin,
  ownerId,
}: {
  code: string;
  codeVerifier: string;
  origin: string;
  ownerId: string;
}) {
  const token = await exchangeToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(origin),
      code_verifier: codeVerifier,
    }),
  );
  if (!token.refresh_token) throw new Error("Spotify did not return a refresh token.");
  const profile = await spotifyApiFetch<SpotifyProfile>(ownerId, "/me", {
    accessToken: token.access_token,
  });
  const accountId = profile.account_id ?? profile.id;
  if (!accountId) throw new Error("Spotify profile response did not contain an account ID.");
  const configuredArtistId = parseSpotifyId(process.env.SPOTIFY_ARTIST_ID ?? "");
  const { error } = await serviceSupabase()
    .from("spotify_accounts")
    .upsert(
      {
        owner_id: ownerId,
        spotify_account_id: accountId,
        display_name: profile.display_name ?? "Spotify user",
        profile_url: profile.external_urls?.spotify ?? null,
        image_url: profile.images?.[0]?.url ?? null,
        artist_id: configuredArtistId || undefined,
        raw_profile: profile as Json,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" },
    );
  if (error) throw new Error(error.message);
  await storeToken(ownerId, { ...token, refresh_token: token.refresh_token });
  return profile;
}

async function refreshSpotifyToken(ownerId: string, refreshToken: string) {
  const token = await exchangeToken(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
  const nextRefreshToken = token.refresh_token ?? refreshToken;
  await storeToken(ownerId, { ...token, refresh_token: nextRefreshToken });
  return token.access_token;
}

async function validAccessToken(ownerId: string) {
  const { data, error } = await serviceSupabase().rpc("get_spotify_token", {
    p_owner_id: ownerId,
  });
  if (error) throw new Error(error.message);
  const token = data?.[0];
  if (!token) throw new Error("Connect Spotify before using the Spotify API.");
  if (new Date(token.expires_at).getTime() > Date.now() + TOKEN_EXPIRY_SKEW_MS) {
    return token.access_token;
  }
  return refreshSpotifyToken(ownerId, token.refresh_token);
}

async function spotifyApiFetch<T>(
  ownerId: string,
  endpoint: string,
  options: RequestInit & { accessToken?: string; retry?: boolean } = {},
): Promise<T> {
  const accessToken = options.accessToken ?? (await validAccessToken(ownerId));
  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE_URL}${endpoint}`;
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(url, { ...options, headers, cache: "no-store" });
  if (response.status === 401 && !options.accessToken && options.retry !== false) {
    const { data, error } = await serviceSupabase().rpc("get_spotify_token", {
      p_owner_id: ownerId,
    });
    if (error) throw new Error(error.message);
    const refreshToken = data?.[0]?.refresh_token;
    if (!refreshToken) throw new SpotifyApiError("Spotify authorization expired.", 401);
    const refreshedAccessToken = await refreshSpotifyToken(ownerId, refreshToken);
    return spotifyApiFetch<T>(ownerId, endpoint, {
      ...options,
      accessToken: refreshedAccessToken,
      retry: false,
    });
  }
  if (response.status === 429 && options.retry !== false) {
    const waitSeconds = Math.min(Number(response.headers.get("retry-after")) || 1, 5);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    return spotifyApiFetch<T>(ownerId, endpoint, { ...options, retry: false });
  }
  if (!response.ok) {
    throw new SpotifyApiError(
      `Spotify API request failed (${response.status}).`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function spotifyPage<T>(ownerId: string, endpoint: string, maxPages = 10) {
  const items: T[] = [];
  let next: string | null = endpoint;
  for (let page = 0; next && page < maxPages; page += 1) {
    const result: Page<T> = await spotifyApiFetch<Page<T>>(ownerId, next);
    items.push(...(result.items ?? []));
    next = result.next ?? null;
  }
  return items;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

export function parseSpotifyId(value: string) {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9]{22}$/.test(trimmed)) return trimmed;
  const uri = trimmed.match(/^spotify:artist:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];
  try {
    const url = new URL(trimmed);
    if (url.hostname === "open.spotify.com") {
      const match = url.pathname.match(/^\/artist\/([A-Za-z0-9]{22})/);
      if (match) return match[1];
    }
  } catch {
    // The value may simply be an invalid ID; return null below.
  }
  return null;
}

export async function setSpotifyArtist(ownerId: string, value: string) {
  const artistId = parseSpotifyId(value);
  if (!artistId) throw new Error("Enter a valid Spotify artist URL, URI, or 22-character ID.");
  const artist = await spotifyApiFetch<SpotifyArtist>(ownerId, `/artists/${artistId}`);
  const { error } = await serviceSupabase()
    .from("spotify_accounts")
    .update({
      artist_id: artist.id,
      artist_name: artist.name,
      artist_url: artist.external_urls?.spotify ?? null,
      artist_image_url: artist.images?.[0]?.url ?? null,
      raw_artist: artist as Json,
    })
    .eq("owner_id", ownerId);
  if (error) throw new Error(error.message);
  return artist;
}

function albumRow(ownerId: string, album: SpotifyAlbum) {
  return {
    owner_id: ownerId,
    spotify_id: album.id,
    name: album.name,
    album_type: album.album_type,
    total_tracks: album.total_tracks,
    release_date: album.release_date || null,
    release_date_precision: album.release_date_precision || null,
    spotify_url: album.external_urls?.spotify ?? `https://open.spotify.com/album/${album.id}`,
    image_url: album.images?.[0]?.url ?? null,
    uri: album.uri,
    raw_album: album as Json,
    synced_at: new Date().toISOString(),
  };
}

function trackRow(ownerId: string, albumId: string, track: SpotifyTrack) {
  return {
    owner_id: ownerId,
    spotify_id: track.id,
    album_spotify_id: albumId,
    name: track.name,
    duration_ms: track.duration_ms,
    explicit: track.explicit,
    disc_number: track.disc_number,
    track_number: track.track_number,
    spotify_url: track.external_urls?.spotify ?? `https://open.spotify.com/track/${track.id}`,
    uri: track.uri,
    isrc: track.external_ids?.isrc ?? null,
    raw_track: track as Json,
    synced_at: new Date().toISOString(),
  };
}

export async function syncSpotify(ownerId: string) {
  const supabase = serviceSupabase();
  const { data: account, error: accountError } = await supabase
    .from("spotify_accounts")
    .select("artist_id")
    .eq("owner_id", ownerId)
    .single();
  if (accountError) throw new Error(accountError.message);
  if (!account.artist_id) throw new Error("Set the Atlas Irwin Spotify artist URL first.");

  const artist = await setSpotifyArtist(ownerId, account.artist_id);
  const albums = await spotifyPage<SpotifyAlbum>(
    ownerId,
    `/artists/${artist.id}/albums?include_groups=album,single,compilation,appears_on&limit=50`,
  );
  const uniqueAlbums = [...new Map(albums.map((album) => [album.id, album])).values()];
  for (const album of uniqueAlbums) {
    const { error: albumError } = await supabase
      .from("spotify_albums")
      .upsert(albumRow(ownerId, album), { onConflict: "owner_id,spotify_id" });
    if (albumError) throw new Error(albumError.message);
    const albumTracks = await spotifyPage<SpotifyTrack>(ownerId, `/albums/${album.id}/tracks?limit=50`);
    if (albumTracks.length) {
      // The album-tracks response is simplified and omits ISRC. Development
      // Mode removed the batch endpoint in 2026, so enrich tracks individually.
      const tracks = await mapWithConcurrency(albumTracks, 3, (track) =>
        spotifyApiFetch<SpotifyTrack>(ownerId, `/tracks/${track.id}`),
      );
      const { error: trackError } = await supabase
        .from("spotify_tracks")
        .upsert(tracks.map((track) => trackRow(ownerId, album.id, track)), {
          onConflict: "owner_id,spotify_id",
        });
      if (trackError) throw new Error(trackError.message);
    }
  }

  const [topArtists, topTracks, playlists] = await Promise.all([
    spotifyApiFetch<Page<SpotifyArtist>>(ownerId, "/me/top/artists?time_range=medium_term&limit=10"),
    spotifyApiFetch<Page<SpotifyTrack>>(ownerId, "/me/top/tracks?time_range=medium_term&limit=10"),
    spotifyPage<SpotifyPlaylist>(ownerId, "/me/playlists?limit=50", 4),
  ]);
  if (playlists.length) {
    const { error: playlistsError } = await supabase
      .from("spotify_playlists")
      .upsert(
        playlists.map((playlist) => ({
          owner_id: ownerId,
          spotify_id: playlist.id,
          name: playlist.name,
          description: playlist.description ?? null,
          spotify_url: playlist.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlist.id}`,
          image_url: playlist.images?.[0]?.url ?? null,
          uri: playlist.uri,
          is_public: playlist.public ?? null,
          collaborative: playlist.collaborative ?? false,
          item_count: playlist.items?.total ?? playlist.tracks?.total ?? 0,
          owner_name: playlist.owner?.display_name ?? null,
          raw_playlist: playlist as Json,
          synced_at: new Date().toISOString(),
        })),
        { onConflict: "owner_id,spotify_id" },
      );
    if (playlistsError) throw new Error(playlistsError.message);
  }
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("spotify_accounts")
    .update({
      top_artists: topArtists.items as Json,
      top_tracks: topTracks.items as Json,
      last_synced_at: now,
    })
    .eq("owner_id", ownerId);
  if (updateError) throw new Error(updateError.message);
  return { albums: uniqueAlbums.length, playlists: playlists.length };
}

export async function createSpotifyCampaignPlaylist({
  ownerId,
  name,
  description,
  isPublic,
  uris,
}: {
  ownerId: string;
  name: string;
  description: string;
  isPublic: boolean;
  uris: string[];
}) {
  const playlist = await spotifyApiFetch<SpotifyPlaylist>(ownerId, "/me/playlists", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, description, public: isPublic }),
  });
  if (uris.length) {
    await spotifyApiFetch(ownerId, `/playlists/${playlist.id}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uris: uris.slice(0, 100) }),
    });
  }
  await syncSpotifyPlaylists(ownerId);
  return playlist;
}

async function syncSpotifyPlaylists(ownerId: string) {
  const playlists = await spotifyPage<SpotifyPlaylist>(ownerId, "/me/playlists?limit=50", 4);
  if (!playlists.length) return;
  const { error } = await serviceSupabase()
    .from("spotify_playlists")
    .upsert(
      playlists.map((playlist) => ({
        owner_id: ownerId,
        spotify_id: playlist.id,
        name: playlist.name,
        description: playlist.description ?? null,
        spotify_url: playlist.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlist.id}`,
        image_url: playlist.images?.[0]?.url ?? null,
        uri: playlist.uri,
        is_public: playlist.public ?? null,
        collaborative: playlist.collaborative ?? false,
        item_count: playlist.items?.total ?? playlist.tracks?.total ?? 0,
        owner_name: playlist.owner?.display_name ?? null,
        raw_playlist: playlist as Json,
        synced_at: new Date().toISOString(),
      })),
      { onConflict: "owner_id,spotify_id" },
    );
  if (error) throw new Error(error.message);
}

export async function disconnectSpotify(ownerId: string) {
  const supabase = serviceSupabase();
  const { error: accountError } = await supabase
    .from("spotify_accounts")
    .delete()
    .eq("owner_id", ownerId);
  if (accountError) throw new Error(accountError.message);
  const { error: tokenError } = await supabase.rpc("delete_spotify_token", {
    p_owner_id: ownerId,
  });
  if (tokenError) throw new Error(tokenError.message);
}
