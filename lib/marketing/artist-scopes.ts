import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAutonomyServiceClient } from "./autonomy-db";
import type { EnsemblisDatabase } from "@/types/ensemblis-database";
import type { MarketingExecutionScope } from "./execution-scope";

export async function listActiveMarketingArtistScopes(limit = 500): Promise<MarketingExecutionScope[]> {
  const db = createAutonomyServiceClient() as unknown as SupabaseClient<EnsemblisDatabase>;
  const bounded = Math.max(1, Math.min(limit, 500));
  const [artists, workspaces] = await Promise.all([
    db.from("artists")
      .select("id,workspace_id,legacy_owner_id,status")
      .eq("status", "active")
      .limit(bounded),
    db.from("workspaces")
      .select("id,created_by,legacy_owner_id")
      .limit(bounded),
  ]);
  const error = artists.error || workspaces.error;
  if (error) throw new Error(error.message);

  const workspaceOwner = new Map(
    (workspaces.data ?? []).map((workspace) => [
      workspace.id,
      workspace.legacy_owner_id ?? workspace.created_by,
    ]),
  );
  const unique = new Map<string, MarketingExecutionScope>();
  for (const artist of artists.data ?? []) {
    const ownerId = artist.legacy_owner_id ?? workspaceOwner.get(artist.workspace_id) ?? null;
    if (!ownerId) continue;
    unique.set(`${ownerId}:${artist.id}`, { ownerId, artistId: artist.id });
  }
  return [...unique.values()];
}
