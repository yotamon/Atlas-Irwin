import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { materializeSceneGrowthOpportunities } from "@/lib/artist-operating/growth-opportunities";
import type { ArtistSceneRelationship } from "@/lib/artist-operating/domain";
import { usableSceneRelationships } from "@/lib/artist-operating/scene-intelligence";
import type { Database, Json } from "@/types/database";
import type { ArtistSceneRelationshipType, EnsemblisDatabase } from "@/types/ensemblis-database";
import { createAutonomyServiceClient } from "./autonomy-db";

const SAFE_MANAGER_ACTIONS: Record<string, {
  relationshipTypes: ArtistSceneRelationshipType[];
  targetCountKey: "liveTargetCount" | "labelTargetCount";
}> = {
  advance_gig_strategy: {
    relationshipTypes: ["promoter", "venue", "festival"],
    targetCountKey: "liveTargetCount",
  },
  advance_label_strategy: {
    relationshipTypes: ["label"],
    targetCountKey: "labelTargetCount",
  },
};

type ScenePreparationResult = {
  prepared: number;
  synced: number;
  inserted: number;
  updated: number;
  lifecyclePreserved: number;
  reason: "unsupported_manager_action" | "artist_not_active" | "no_verified_targets" | "growth_opportunities_prepared" | "targets_already_resolved";
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asJson(value: unknown) {
  return value as Json;
}

function retryBlocked(payload: Record<string, unknown>, now: Date) {
  const execution = record(payload.managerExecution);
  const retryAfter = typeof execution.retryAfter === "string" ? Date.parse(execution.retryAfter) : Number.NaN;
  return Number.isFinite(retryAfter) && retryAfter > now.getTime();
}

function eligibleManagerAction(action: {
  action_type: string;
  payload: Json;
}, now: Date) {
  const config = SAFE_MANAGER_ACTIONS[action.action_type];
  if (!config) return false;
  const payload = record(action.payload);
  if (payload.managerOwned !== true) return false;
  if (retryBlocked(payload, now)) return false;
  return Number(payload[config.targetCountKey] ?? 0) > 0;
}

function emptyResult(reason: ScenePreparationResult["reason"]): ScenePreparationResult {
  return { prepared: 0, synced: 0, inserted: 0, updated: 0, lifecyclePreserved: 0, reason };
}

function mappedRelationship(row: {
  id: string;
  relationship_type: ArtistSceneRelationshipType;
  target_name: string;
  target_url: string | null;
  fit_score: number;
  confidence: number;
  evidence: Json;
  status: "candidate" | "verified" | "dismissed" | "contacted";
  observed_at: string | null;
  expires_at: string | null;
}): ArtistSceneRelationship {
  return {
    id: row.id,
    type: row.relationship_type,
    targetName: row.target_name,
    targetUrl: row.target_url,
    fitScore: Number(row.fit_score),
    confidence: Number(row.confidence),
    evidence: record(row.evidence),
    status: row.status === "dismissed" ? "candidate" : row.status,
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
  };
}

async function claimAction(action: {
  id: string;
  owner_id: string;
  artist_id: string;
}) {
  const autonomy = createAutonomyServiceClient();
  const { data, error } = await autonomy.from("next_best_actions")
    .update({ status: "executing" })
    .eq("id", action.id)
    .eq("owner_id", action.owner_id)
    .eq("artist_id", action.artist_id)
    .eq("status", "proposed")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function executeScenePreparation(action: {
  owner_id: string;
  artist_id: string;
  action_type: string;
}): Promise<ScenePreparationResult> {
  const config = SAFE_MANAGER_ACTIONS[action.action_type];
  if (!config) return emptyResult("unsupported_manager_action");

  const autonomy = createAutonomyServiceClient();
  const operating = autonomy as unknown as SupabaseClient<EnsemblisDatabase>;
  const [artistResult, relationshipsResult] = await Promise.all([
    operating.from("artists")
      .select("id,name,status")
      .eq("id", action.artist_id)
      .eq("status", "active")
      .maybeSingle(),
    operating.from("artist_scene_relationships")
      .select("id,relationship_type,target_name,target_url,fit_score,confidence,evidence,status,observed_at,expires_at")
      .eq("artist_id", action.artist_id)
      .in("status", ["verified", "contacted"])
      .order("fit_score", { ascending: false })
      .limit(40),
  ]);
  if (artistResult.error) throw new Error(artistResult.error.message);
  if (relationshipsResult.error) throw new Error(relationshipsResult.error.message);
  if (!artistResult.data) return emptyResult("artist_not_active");

  const allowedTypes = new Set<ArtistSceneRelationshipType>(config.relationshipTypes);
  const relationships = usableSceneRelationships(
    (relationshipsResult.data ?? []).map(mappedRelationship),
  ).filter((relationship) =>
    allowedTypes.has(relationship.type)
    && relationship.status !== "candidate"
    && relationship.fitScore >= 60
    && relationship.confidence >= 0.35,
  );

  if (!relationships.length) return emptyResult("no_verified_targets");

  const result = await materializeSceneGrowthOpportunities({
    client: autonomy as unknown as SupabaseClient<Database>,
    ownerId: action.owner_id,
    artistId: action.artist_id,
    artistName: artistResult.data.name,
    relationships,
    includeSceneMapFallback: false,
  });
  return {
    prepared: result.actionablePrepared,
    synced: result.synced,
    inserted: result.inserted,
    updated: result.updated,
    lifecyclePreserved: result.lifecyclePreserved,
    reason: result.actionablePrepared > 0 ? "growth_opportunities_prepared" : "targets_already_resolved",
  };
}

export async function executeSafeManagerActions(limit = 20) {
  const autonomy = createAutonomyServiceClient();
  const now = new Date();
  const boundedLimit = Math.max(1, Math.min(limit, 50));
  const { data: proposed, error } = await autonomy.from("next_best_actions")
    .select("*")
    .eq("status", "proposed")
    .eq("source_type", "artist_operating_profile")
    .order("score", { ascending: false })
    .limit(boundedLimit);
  if (error) throw new Error(error.message);

  const eligible = (proposed ?? []).filter((action) => eligibleManagerAction(action, now));
  let claimed = 0;
  let completed = 0;
  let deferred = 0;
  let failed = 0;

  for (const candidate of eligible) {
    const action = await claimAction(candidate);
    if (!action) continue;
    claimed += 1;
    const payload = record(action.payload);

    try {
      const result = await executeScenePreparation(action);
      const completedAt = new Date().toISOString();
      if (result.prepared <= 0) {
        const { error: expireError } = await autonomy.from("next_best_actions").update({
          status: "expired",
          payload: asJson({
            ...payload,
            managerExecution: {
              outcome: result.reason,
              completedAt,
              prepared: 0,
              synced: result.synced,
              lifecyclePreserved: result.lifecyclePreserved,
            },
          }),
        }).eq("id", action.id).eq("owner_id", action.owner_id).eq("artist_id", action.artist_id).eq("status", "executing");
        if (expireError) throw new Error(expireError.message);
        deferred += 1;
        continue;
      }

      const { error: completeError } = await autonomy.from("next_best_actions").update({
        status: "completed",
        payload: asJson({
          ...payload,
          managerExecution: {
            outcome: result.reason,
            completedAt,
            prepared: result.prepared,
            synced: result.synced,
            inserted: result.inserted,
            updated: result.updated,
            lifecyclePreserved: result.lifecyclePreserved,
          },
        }),
      }).eq("id", action.id).eq("owner_id", action.owner_id).eq("artist_id", action.artist_id).eq("status", "executing");
      if (completeError) throw new Error(completeError.message);
      completed += 1;
    } catch (executionError) {
      const retryAfter = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const { error: restoreError } = await autonomy.from("next_best_actions").update({
        status: "proposed",
        payload: asJson({
          ...payload,
          managerExecution: {
            outcome: "retry_scheduled",
            attemptedAt: new Date().toISOString(),
            retryAfter,
            lastError: executionError instanceof Error ? executionError.message : "Safe Manager execution failed.",
          },
        }),
      }).eq("id", action.id).eq("owner_id", action.owner_id).eq("artist_id", action.artist_id).eq("status", "executing");
      if (restoreError) throw new Error(restoreError.message);
      failed += 1;
    }
  }

  return {
    scanned: proposed?.length ?? 0,
    eligible: eligible.length,
    claimed,
    completed,
    deferred,
    failed,
  };
}
