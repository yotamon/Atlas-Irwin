import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
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

/**
 * Transitional resolver for the Ensemblis migration.
 *
 * During the compatibility window the existing production owner has a deterministic
 * legacy_owner_id mapping to its default artist. Future users without that mapping
 * resolve automatically only when their active membership/artist choice is
 * unambiguous. Once a workspace contains multiple selectable artists, callers must
 * move to an explicit validated artist selection rather than guessing.
 */
export async function resolveDefaultArtistContext(
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

export async function requireArtistContext(): Promise<ArtistContext> {
  const { supabase, user } = await requireStudioAdmin();
  return resolveDefaultArtistContext(supabase, user);
}
