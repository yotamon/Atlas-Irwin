import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtistSceneProfile, ArtistSceneRelationship } from "@/lib/artist-operating/domain";
import { sceneRelationshipOpportunityKind } from "@/lib/artist-operating/scene-intelligence";
import { asGrowthClient } from "@/lib/studio/growth-db";
import type { Database, Json } from "@/types/database";

function json(value: unknown) {
  return value as Json;
}

const TERMINAL_GROWTH_STATUSES = new Set(["accepted", "dismissed", "completed"]);

export async function materializeSceneGrowthOpportunities({
  client,
  ownerId,
  artistId,
  artistName,
  relationships,
  scene,
  includeSceneMapFallback = true,
}: {
  client: SupabaseClient<Database>;
  ownerId: string;
  artistId: string;
  artistName: string;
  relationships: ArtistSceneRelationship[];
  scene?: ArtistSceneProfile | null;
  includeSceneMapFallback?: boolean;
}) {
  const growth = asGrowthClient(client);
  const rows = relationships.map((relationship) => ({
    owner_id: ownerId,
    artist_id: artistId,
    kind: sceneRelationshipOpportunityKind(relationship.type),
    title: `${relationship.targetName} may fit ${artistName}`,
    rationale: `This ${relationship.type.replaceAll("_", " ")} relationship is backed by stored scene evidence. Review the fit before any outreach or external action.`,
    priority: relationship.fitScore,
    confidence: relationship.confidence,
    evidence: json({ scene_relationship_id: relationship.id, ...relationship.evidence }),
    recommended_action: json({ type: "review_scene_relationship", relationship_id: relationship.id, href: "/studio/growth/strategy" }),
    dedupe_key: `artist:${artistId}:scene:${relationship.id}`,
    status: "new" as const,
  }));

  let usedSceneMapFallback = false;
  if (!rows.length && includeSceneMapFallback && scene?.primaryScene) {
    usedSceneMapFallback = true;
    rows.push({
      owner_id: ownerId,
      artist_id: artistId,
      kind: "scene_fit",
      title: `Map the ${scene.primaryScene} ecosystem`,
      rationale: "The artist has explicitly identified this scene, but Ensemblis does not yet have enough evidence to name labels, playlists, channels, promoters or festivals. Research should happen before outreach.",
      priority: 65,
      confidence: Math.max(0.5, scene.confidence),
      evidence: json({ source: "artist_scene_profile", scene: scene.primaryScene, evidence: scene.evidence }),
      recommended_action: json({ type: "research_scene", href: "/studio/growth/strategy" }),
      dedupe_key: `artist:${artistId}:scene-map:${scene.primaryScene.toLowerCase()}`,
      status: "new" as const,
    });
  }

  let inserted = 0;
  let updated = 0;
  let lifecyclePreserved = 0;

  for (const row of rows) {
    const { data: existing, error: lookupError } = await growth
      .from("growth_opportunities")
      .select("id,status")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .eq("dedupe_key", row.dedupe_key)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);

    if (existing) {
      const preserveLifecycle = TERMINAL_GROWTH_STATUSES.has(existing.status);
      const update = preserveLifecycle ? { ...row, status: existing.status } : row;
      const { error } = await growth
        .from("growth_opportunities")
        .update(update)
        .eq("id", existing.id)
        .eq("owner_id", ownerId)
        .eq("artist_id", artistId);
      if (error) throw new Error(error.message);
      updated += 1;
      if (preserveLifecycle) lifecyclePreserved += 1;
      continue;
    }

    const { error } = await growth.from("growth_opportunities").insert(row);
    if (error) throw new Error(error.message);
    inserted += 1;
  }

  const synced = inserted + updated;
  return {
    synced,
    actionablePrepared: Math.max(0, synced - lifecyclePreserved),
    inserted,
    updated,
    lifecyclePreserved,
    usedSceneMapFallback,
  };
}
