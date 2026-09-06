import "server-only";

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ENSEMBLIS_ACTIVE_ARTIST_COOKIE } from "@/lib/ensemblis-product";
import type {
  Artist,
  Database,
  Workspace,
  WorkspaceMembership,
  WorkspaceRole,
} from "@/types/database";

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

  constructor(code: ArtistContextError["code"], message: string) {
    super(message);
    this.name = "ArtistContextError";
    this.code = code;
  }
}

async function loadWorkspace(db: SupabaseClient<Database>, workspaceId: string) {
  const { data, error } = await db
    .from("workspaces")
    .select("id,name,slug,kind,created_by,timezone,locale,currency,created_at,updated_at")
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
  db: SupabaseClient<Database>,
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
  db: SupabaseClient<Database>,
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

export async function resolveArtistContext(
  client: SupabaseClient<Database>,
  identity: StudioIdentity,
  artistId: string,
): Promise<ArtistContext> {
  const { data, error } = await client
    .from("artists")
    .select("id,workspace_id,name,slug,project_type,status,avatar_url,accent_color,created_at,updated_at")
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

  return buildContext(client, identity, data as Artist);
}

export async function listAccessibleArtists(
  client: SupabaseClient<Database>,
  identity: StudioIdentity,
): Promise<AccessibleArtist[]> {
  const membershipsResult = await client
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
    client
      .from("workspaces")
      .select("id,name,slug,kind,created_by,timezone,locale,currency,created_at,updated_at")
      .in("id", workspaceIds),
    client
      .from("artists")
      .select("id,workspace_id,name,slug,project_type,status,avatar_url,accent_color,created_at,updated_at")
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

async function resolveUnambiguousArtistContext(
  client: SupabaseClient<Database>,
  identity: StudioIdentity,
): Promise<ArtistContext> {
  const artists = await listAccessibleArtists(client, identity);
  if (!artists.length) {
    throw new ArtistContextError(
      "artist_context_missing",
      "No Ensemblis artist is available for this account yet.",
    );
  }
  if (artists.length > 1) {
    throw new ArtistContextError(
      "artist_context_ambiguous",
      "Select an artist before continuing.",
    );
  }
  return resolveArtistContext(client, identity, artists[0].artistId);
}

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

  return resolveUnambiguousArtistContext(client, identity);
}

export async function requireArtistContext(artistId?: string): Promise<ArtistContext> {
  const { supabase, user } = await requireStudioAdmin();
  return resolveActiveArtistContext(supabase, user, artistId);
}
