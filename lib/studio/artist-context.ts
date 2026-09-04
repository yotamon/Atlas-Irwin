import "server-only";

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ENSEMBLIS_ACTIVE_ARTIST_COOKIE } from "@/lib/ensemblis-product";
import type { Database } from "@/types/database";
import type {
  Artist,
  EnsemblisDatabase,
  Workspace,
  WorkspaceMembership,
  WorkspaceRole,
} from "@/types/ensemblis-database";

type StudioIdentity = {
  id: string;
  email?: string | null;
};

export type ArtistContext = {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  artistId: string;
  artistName: string;
  artistSlug: string;
  role: WorkspaceRole;
};

export type AccessibleArtist = {
  artistId: string;
  artistName: string;
  artistSlug: string;
  avatarUrl: string | null;
  accentColor: string | null;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: WorkspaceRole;
};

export class ArtistContextError extends Error {
  readonly code:
    | "artist_context_missing"
    | "artist_context_ambiguous"
    | "artist_context_forbidden"
    | "artist_context_invalid";

  constructor(
    code: ArtistContextError["code"],
    message: string,
  ) {
    super(message);
    this.name = "ArtistContextError";
    this.code = code;
  }
}

function asEnsemblisClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<EnsemblisDatabase>;
}

async function loadWorkspace(
  db: SupabaseClient<EnsemblisDatabase>,
  workspaceId: string,
) {
  const { data, error } = await db
    .from("workspaces")
    .select("id,name,slug,kind,created_by,legacy_owner_id,created_at,updated_at")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) throw new ArtistContextError("artist_context_invalid", error.message);
  if (!data) {
    throw new ArtistContextError(
      "artist_context_invalid",
      "The artist workspace no longer exists or is not accessible.",
    );
  }
  return data as Workspace;
}

async function loadMembership(
  db: SupabaseClient<EnsemblisDatabase>,
  userId: string,
  workspaceId: string,
) {
  const { data, error } = await db
    .from("workspace_memberships")
    .select("workspace_id,profile_id,role,status,created_at,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("profile_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new ArtistContextError("artist_context_invalid", error.message);
  if (!data) {
    throw new ArtistContextError(
      "artist_context_forbidden",
      "You no longer have active access to this artist workspace.",
    );
  }
  return data as WorkspaceMembership;
}

async function buildContext(
  db: SupabaseClient<EnsemblisDatabase>,
  identity: StudioIdentity,
  artist: Artist,
): Promise<ArtistContext> {
  const [membership, workspace] = await Promise.all([
    loadMembership(db, identity.id, artist.workspace_id),
    loadWorkspace(db, artist.workspace_id),
  ]);

  return {
    userId: identity.id,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceSlug: workspace.slug,
    artistId: artist.id,
    artistName: artist.name,
    artistSlug: artist.slug,
    role: membership.role,
  };
}

/** Resolve one explicitly requested artist and validate active workspace membership. */
export async function resolveArtistContext(
  client: SupabaseClient<Database>,
  identity: StudioIdentity,
  artistId: string,
): Promise<ArtistContext> {
  const db = asEnsemblisClient(client);
  const { data, error } = await db
    .from("artists")
    .select("id,workspace_id,name,slug,project_type,status,avatar_url,accent_color,legacy_owner_id,created_at,updated_at")
    .eq("id", artistId)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new ArtistContextError("artist_context_invalid", error.message);
  if (!data) {
    throw new ArtistContextError(
      "artist_context_forbidden",
      "The requested artist does not exist or is not accessible.",
    );
  }

  return buildContext(db, identity, data as Artist);
}

/** Return every active artist available through the user's active workspace memberships. */
export async function listAccessibleArtists(
  client: SupabaseClient<Database>,
  identity: StudioIdentity,
): Promise<AccessibleArtist[]> {
  const db = asEnsemblisClient(client);
  const membershipsResult = await db
    .from("workspace_memberships")
    .select("workspace_id,profile_id,role,status,created_at,updated_at")
    .eq("profile_id", identity.id)
    .eq("status", "active");

  if (membershipsResult.error) {
    throw new ArtistContextError("artist_context_invalid", membershipsResult.error.message);
  }

  const memberships = (membershipsResult.data ?? []) as WorkspaceMembership[];
  if (!memberships.length) return [];

  const workspaceIds = Array.from(new Set(memberships.map((membership) => membership.workspace_id)));
  const [workspacesResult, artistsResult] = await Promise.all([
    db
      .from("workspaces")
      .select("id,name,slug,kind,created_by,legacy_owner_id,created_at,updated_at")
      .in("id", workspaceIds),
    db
      .from("artists")
      .select("id,workspace_id,name,slug,project_type,status,avatar_url,accent_color,legacy_owner_id,created_at,updated_at")
      .in("workspace_id", workspaceIds)
      .eq("status", "active")
      .order("name", { ascending: true }),
  ]);

  if (workspacesResult.error) {
    throw new ArtistContextError("artist_context_invalid", workspacesResult.error.message);
  }
  if (artistsResult.error) {
    throw new ArtistContextError("artist_context_invalid", artistsResult.error.message);
  }

  const membershipsByWorkspace = new Map(
    memberships.map((membership) => [membership.workspace_id, membership]),
  );
  const workspacesById = new Map(
    ((workspacesResult.data ?? []) as Workspace[]).map((workspace) => [workspace.id, workspace]),
  );

  return ((artistsResult.data ?? []) as Artist[])
    .flatMap((artist) => {
      const workspace = workspacesById.get(artist.workspace_id);
      const membership = membershipsByWorkspace.get(artist.workspace_id);
      if (!workspace || !membership) return [];
      return [{
        artistId: artist.id,
        artistName: artist.name,
        artistSlug: artist.slug,
        avatarUrl: artist.avatar_url,
        accentColor: artist.accent_color,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
        role: membership.role,
      } satisfies AccessibleArtist];
    })
    .sort((left, right) =>
      left.workspaceName.localeCompare(right.workspaceName) ||
      left.artistName.localeCompare(right.artistName),
    );
}

/**
 * Last-resort transitional fallback for accounts that have not persisted an active
 * artist yet. This function must remain internal so product callers cannot bypass
 * the active-artist preference by asking for the legacy/default artist directly.
 */
async function resolveLegacyFallbackArtistContext(
  client: SupabaseClient<Database>,
  identity: StudioIdentity,
): Promise<ArtistContext> {
  const db = asEnsemblisClient(client);

  const legacyResult = await db
    .from("artists")
    .select("id,workspace_id,name,slug,project_type,status,avatar_url,accent_color,legacy_owner_id,created_at,updated_at")
    .eq("legacy_owner_id", identity.id)
    .eq("status", "active")
    .limit(2);

  if (legacyResult.error) {
    throw new ArtistContextError("artist_context_invalid", legacyResult.error.message);
  }

  const legacyArtists = (legacyResult.data ?? []) as Artist[];
  if (legacyArtists.length === 1) {
    return buildContext(db, identity, legacyArtists[0]);
  }
  if (legacyArtists.length > 1) {
    throw new ArtistContextError(
      "artist_context_invalid",
      "More than one legacy artist mapping exists for this account.",
    );
  }

  const membershipResult = await db
    .from("workspace_memberships")
    .select("workspace_id,profile_id,role,status,created_at,updated_at")
    .eq("profile_id", identity.id)
    .eq("status", "active")
    .limit(2);

  if (membershipResult.error) {
    throw new ArtistContextError("artist_context_invalid", membershipResult.error.message);
  }

  const memberships = (membershipResult.data ?? []) as WorkspaceMembership[];
  if (!memberships.length) {
    throw new ArtistContextError(
      "artist_context_missing",
      "No Ensemblis workspace is available for this account yet.",
    );
  }
  if (memberships.length > 1) {
    throw new ArtistContextError(
      "artist_context_ambiguous",
      "Select a workspace before continuing.",
    );
  }

  const artistResult = await db
    .from("artists")
    .select("id,workspace_id,name,slug,project_type,status,avatar_url,accent_color,legacy_owner_id,created_at,updated_at")
    .eq("workspace_id", memberships[0].workspace_id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(2);

  if (artistResult.error) {
    throw new ArtistContextError("artist_context_invalid", artistResult.error.message);
  }

  const artists = (artistResult.data ?? []) as Artist[];
  if (!artists.length) {
    throw new ArtistContextError(
      "artist_context_missing",
      "This workspace does not contain an active artist yet.",
    );
  }
  if (artists.length > 1) {
    throw new ArtistContextError(
      "artist_context_ambiguous",
      "Select an artist before continuing.",
    );
  }

  return buildContext(db, identity, artists[0]);
}

/** Resolve the validated request preference, falling back only when a persisted choice is stale. */
export async function resolveActiveArtistContext(
  client: SupabaseClient<Database>,
  identity: StudioIdentity,
  artistId?: string,
): Promise<ArtistContext> {
  if (artistId) return resolveArtistContext(client, identity, artistId);

  const cookieStore = await cookies();
  const preferredArtistId = cookieStore.get(ENSEMBLIS_ACTIVE_ARTIST_COOKIE)?.value?.trim();
  if (preferredArtistId) {
    try {
      return await resolveArtistContext(client, identity, preferredArtistId);
    } catch (error) {
      if (!(error instanceof ArtistContextError)) throw error;
      if (error.code !== "artist_context_forbidden" && error.code !== "artist_context_invalid") {
        throw error;
      }
    }
  }

  return resolveLegacyFallbackArtistContext(client, identity);
}

/**
 * @deprecated Existing callers receive the active artist for safety. New product code
 * should use resolveActiveArtistContext or requireArtistContext explicitly.
 */
export async function resolveDefaultArtistContext(
  client: SupabaseClient<Database>,
  identity: StudioIdentity,
): Promise<ArtistContext> {
  return resolveActiveArtistContext(client, identity);
}

export async function requireArtistContext(artistId?: string): Promise<ArtistContext> {
  const { supabase, user } = await requireStudioAdmin();
  return resolveActiveArtistContext(supabase, user, artistId);
}
