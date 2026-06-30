import { createHash, randomBytes } from "crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/config";
import type { Database, Json, SoundCloudTrack } from "@/types/database";

const API_BASE_URL = "https://api.soundcloud.com";
const AUTHORIZE_URL = "https://secure.soundcloud.com/authorize";
const TOKEN_URL = "https://secure.soundcloud.com/oauth/token";
const TOKEN_EXPIRY_SKEW_MS = 60_000;

type TokenResponse = {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	scope?: string;
};

export type SoundCloudProfile = {
	id?: number | string;
	urn?: string;
	username?: string;
	permalink_url?: string;
	avatar_url?: string;
};

export type SoundCloudApiTrack = {
	id?: number | string;
	title?: string;
	description?: string | null;
	genre?: string | null;
	permalink_url?: string;
	artwork_url?: string | null;
	duration?: number | null;
	playback_count?: number | null;
	favoritings_count?: number | null;
	likes_count?: number | null;
	comment_count?: number | null;
	reposts_count?: number | null;
	streamable?: boolean;
	downloadable?: boolean;
	sharing?: string | null;
	created_at?: string;
};

type SoundCloudApiPlaylist = {
	id?: number | string;
	title?: string;
	description?: string | null;
	genre?: string | null;
	permalink_url?: string;
	artwork_url?: string | null;
	duration?: number | null;
	track_count?: number | null;
	tracks?: unknown[];
};

type CollectionResponse<T> = {
	collection?: T[];
	next_href?: string | null;
};

function soundCloudClientEnv() {
	const clientId = process.env.SOUNDCLOUD_CLIENT_ID?.trim();
	const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET?.trim();
	if (!clientId || !clientSecret) {
		throw new Error("SoundCloud client environment variables are missing.");
	}
	return { clientId, clientSecret };
}

function serviceSupabase() {
	const { url } = getSupabaseEnv();
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (!key) {
		throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for SoundCloud token storage.");
	}
	return createSupabaseClient<Database>(url, key, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
}

function base64Url(buffer: Buffer) {
	return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function redirectUri(origin: string) {
	return process.env.SOUNDCLOUD_REDIRECT_URI?.trim() || `${origin.replace(/\/$/, "")}/studio/soundcloud/callback`;
}

export function hasSoundCloudEnv() {
	return Boolean(process.env.SOUNDCLOUD_CLIENT_ID?.trim() && process.env.SOUNDCLOUD_CLIENT_SECRET?.trim());
}

export function createSoundCloudAuthorizeUrl(origin: string) {
	const { clientId } = soundCloudClientEnv();
	const state = base64Url(randomBytes(32));
	const codeVerifier = base64Url(randomBytes(64));
	const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
	const url = new URL(AUTHORIZE_URL);
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("redirect_uri", redirectUri(origin));
	url.searchParams.set("response_type", "code");
	url.searchParams.set("code_challenge", codeChallenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	return { url, state, codeVerifier };
}

async function exchangeToken(body: URLSearchParams) {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: {
			accept: "application/json; charset=utf-8",
			"content-type": "application/x-www-form-urlencoded"
		},
		body
	});
	if (!response.ok) {
		throw new Error(`SoundCloud token exchange failed: ${await response.text()}`);
	}
	return (await response.json()) as TokenResponse;
}

export async function completeSoundCloudOAuth({ code, codeVerifier, origin, ownerId }: { code: string; codeVerifier: string; origin: string; ownerId: string }) {
	const { clientId, clientSecret } = soundCloudClientEnv();
	const token = await exchangeToken(
		new URLSearchParams({
			grant_type: "authorization_code",
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri(origin),
			code,
			code_verifier: codeVerifier
		})
	);
	if (!token.refresh_token) {
		throw new Error("SoundCloud did not return a refresh token.");
	}
	const profile = await soundCloudApiFetch<SoundCloudProfile>(ownerId, "/me", {
		accessToken: token.access_token
	});
	await storeSoundCloudConnection(ownerId, token, profile);
	return profile;
}

async function storeSoundCloudConnection(ownerId: string, token: TokenResponse, profile: SoundCloudProfile) {
	const supabase = serviceSupabase();
	const soundCloudUserId = String(profile.id ?? profile.urn ?? "");
	if (!soundCloudUserId || !profile.username) {
		throw new Error("SoundCloud profile response was missing an id or username.");
	}
	const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
	const { error: accountError } = await supabase.from("soundcloud_accounts").upsert(
		{
			owner_id: ownerId,
			soundcloud_user_id: soundCloudUserId,
			username: profile.username,
			permalink_url: profile.permalink_url ?? null,
			avatar_url: profile.avatar_url ?? null,
			raw_profile: profile as Json,
			connected_at: new Date().toISOString()
		},
		{ onConflict: "owner_id" }
	);
	if (accountError) throw new Error(accountError.message);

	const { error: tokenError } = await supabase
		.schema("private")
		.from("soundcloud_tokens")
		.upsert(
			{
				owner_id: ownerId,
				access_token: token.access_token,
				refresh_token: token.refresh_token,
				scope: token.scope ?? null,
				expires_at: expiresAt
			},
			{ onConflict: "owner_id" }
		);
	if (tokenError) throw new Error(tokenError.message);
}

async function refreshSoundCloudToken(ownerId: string, refreshToken: string) {
	const { clientId, clientSecret } = soundCloudClientEnv();
	const token = await exchangeToken(
		new URLSearchParams({
			grant_type: "refresh_token",
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken
		})
	);
	const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
	const nextRefreshToken = token.refresh_token ?? refreshToken;
	const { error } = await serviceSupabase()
		.schema("private")
		.from("soundcloud_tokens")
		.update({
			access_token: token.access_token,
			refresh_token: nextRefreshToken,
			scope: token.scope ?? null,
			expires_at: expiresAt
		})
		.eq("owner_id", ownerId);
	if (error) throw new Error(error.message);
	return token.access_token;
}

async function validAccessToken(ownerId: string) {
	const { data, error } = await serviceSupabase().schema("private").from("soundcloud_tokens").select("*").eq("owner_id", ownerId).single();
	if (error) throw new Error(error.message);
	if (new Date(data.expires_at).getTime() > Date.now() + TOKEN_EXPIRY_SKEW_MS) {
		return data.access_token;
	}
	return refreshSoundCloudToken(ownerId, data.refresh_token);
}

async function soundCloudApiFetch<T>(ownerId: string, endpoint: string, options: RequestInit & { accessToken?: string } = {}) {
	const accessToken = options.accessToken ?? (await validAccessToken(ownerId));
	const url = endpoint.startsWith("http") ? endpoint : `${API_BASE_URL}${endpoint}`;
	const headers = new Headers(options.headers);
	headers.set("accept", "application/json; charset=utf-8");
	headers.set("Authorization", `OAuth ${accessToken}`);
	const response = await fetch(url, { ...options, headers });
	if (!response.ok) {
		throw new Error(`SoundCloud API request failed: ${response.status} ${await response.text()}`);
	}
	return (await response.json()) as T;
}

async function soundCloudCollection<T>(ownerId: string, endpoint: string, maxPages = 4) {
	const items: T[] = [];
	let next: string | null = endpoint;
	for (let page = 0; next && page < maxPages; page += 1) {
		const response: CollectionResponse<T> | T[] = await soundCloudApiFetch<
			CollectionResponse<T> | T[]
		>(ownerId, next);
		if (Array.isArray(response)) {
			items.push(...response);
			next = null;
		} else {
			items.push(...(response.collection ?? []));
			next = response.next_href ?? null;
		}
	}
	return items;
}

function numberOrZero(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function trackRow(ownerId: string, track: SoundCloudApiTrack) {
	const soundcloudId = Number(track.id);
	if (!Number.isFinite(soundcloudId) || !track.title || !track.permalink_url) {
		throw new Error("SoundCloud track response was missing id, title, or permalink_url.");
	}
	return {
		owner_id: ownerId,
		soundcloud_id: soundcloudId,
		title: track.title,
		description: track.description ?? null,
		genre: track.genre ?? null,
		permalink_url: track.permalink_url,
		artwork_url: track.artwork_url ?? null,
		duration: track.duration ?? null,
		playback_count: numberOrZero(track.playback_count),
		favoritings_count: numberOrZero(track.favoritings_count ?? track.likes_count),
		comment_count: numberOrZero(track.comment_count),
		reposts_count: numberOrZero(track.reposts_count),
		streamable: Boolean(track.streamable),
		downloadable: Boolean(track.downloadable),
		sharing: track.sharing ?? null,
		raw_track: track as Json,
		synced_at: new Date().toISOString()
	};
}

function playlistRow(ownerId: string, playlist: SoundCloudApiPlaylist) {
	const soundcloudId = Number(playlist.id);
	if (!Number.isFinite(soundcloudId) || !playlist.title || !playlist.permalink_url) {
		throw new Error("SoundCloud playlist response was missing id, title, or permalink_url.");
	}
	return {
		owner_id: ownerId,
		soundcloud_id: soundcloudId,
		title: playlist.title,
		description: playlist.description ?? null,
		genre: playlist.genre ?? null,
		permalink_url: playlist.permalink_url,
		artwork_url: playlist.artwork_url ?? null,
		duration: playlist.duration ?? null,
		track_count: numberOrZero(playlist.track_count ?? playlist.tracks?.length),
		raw_playlist: playlist as Json,
		synced_at: new Date().toISOString()
	};
}

export async function syncSoundCloudCatalog(ownerId: string) {
	const [tracks, playlists] = await Promise.all([
		soundCloudCollection<SoundCloudApiTrack>(ownerId, "/me/tracks?limit=50&linked_partitioning=true"),
		soundCloudCollection<SoundCloudApiPlaylist>(ownerId, "/me/playlists?show_tracks=true&limit=50&linked_partitioning=true")
	]);
	const supabase = serviceSupabase();
	if (tracks.length) {
		const { error } = await supabase.from("soundcloud_tracks").upsert(
			tracks.map(track => trackRow(ownerId, track)),
			{ onConflict: "owner_id,soundcloud_id" }
		);
		if (error) throw new Error(error.message);
	}
	if (playlists.length) {
		const { error } = await supabase.from("soundcloud_playlists").upsert(
			playlists.map(playlist => playlistRow(ownerId, playlist)),
			{ onConflict: "owner_id,soundcloud_id" }
		);
		if (error) throw new Error(error.message);
	}
	const { error } = await supabase.from("soundcloud_accounts").update({ last_synced_at: new Date().toISOString() }).eq("owner_id", ownerId);
	if (error) throw new Error(error.message);
	return { tracks: tracks.length, playlists: playlists.length };
}

export async function syncSoundCloudTrack(ownerId: string, soundcloudId: number) {
	const track = await soundCloudApiFetch<SoundCloudApiTrack>(ownerId, `/tracks/${soundcloudId}`);
	const row = trackRow(ownerId, track);
	const { data, error } = await serviceSupabase().from("soundcloud_tracks").upsert(row, { onConflict: "owner_id,soundcloud_id" }).select("*").single();
	if (error) throw new Error(error.message);
	return data as SoundCloudTrack;
}

export async function uploadSoundCloudTrack({
	ownerId,
	title,
	file,
	description,
	genre,
	sharing
}: {
	ownerId: string;
	title: string;
	file: File;
	description?: string | null;
	genre?: string | null;
	sharing?: string | null;
}) {
	const body = new FormData();
	body.set("track[title]", title);
	body.set("track[asset_data]", file);
	if (description) body.set("track[description]", description);
	if (genre) body.set("track[genre]", genre);
	if (sharing) body.set("track[sharing]", sharing);
	const track = await soundCloudApiFetch<SoundCloudApiTrack>(ownerId, "/tracks", { method: "POST", body });
	const row = trackRow(ownerId, track);
	const { data, error } = await serviceSupabase().from("soundcloud_tracks").upsert(row, { onConflict: "owner_id,soundcloud_id" }).select("*").single();
	if (error) throw new Error(error.message);
	return data as SoundCloudTrack;
}

export async function disconnectSoundCloud(ownerId: string) {
	const supabase = serviceSupabase();
	const { error: tokenError } = await supabase.schema("private").from("soundcloud_tokens").delete().eq("owner_id", ownerId);
	if (tokenError) throw new Error(tokenError.message);
	const { error: accountError } = await supabase.from("soundcloud_accounts").delete().eq("owner_id", ownerId);
	if (accountError) throw new Error(accountError.message);
}

export function soundCloudSnapshot(track: Pick<SoundCloudTrack, "playback_count" | "favoritings_count" | "comment_count" | "reposts_count">) {
	return {
		views: track.playback_count,
		streams: track.playback_count,
		likes: track.favoritings_count,
		comments: track.comment_count,
		shares: track.reposts_count
	};
}
