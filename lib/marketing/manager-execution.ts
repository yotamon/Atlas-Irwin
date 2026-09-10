import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareOwnedAudienceOpportunity } from "@/lib/audience/owned-audience-preparation";
import { materializeSceneGrowthOpportunities } from "@/lib/artist-operating/growth-opportunities";
import type { ArtistSceneRelationship } from "@/lib/artist-operating/domain";
import { usableSceneRelationships } from "@/lib/artist-operating/scene-intelligence";
import { prepareDetectedGrowthOpportunities, prepareReleaseGrowthPlan } from "@/lib/studio/growth-preparation";
import type { Database, Json } from "@/types/database";
import type { ArtistSceneRelationshipType, EnsemblisDatabase } from "@/types/ensemblis-database";
import type { GrowthOpportunityKind } from "@/types/growth-database";
import { createAutonomyServiceClient } from "./autonomy-db";

const SAFE_MANAGER_ACTIONS: Record<string, {
  relationshipTypes?: ArtistSceneRelationshipType[];
  targetCountKey?: "liveTargetCount" | "labelTargetCount";
  growthKinds?: GrowthOpportunityKind[];
  releasePlan?: boolean;
  ownedAudience?: boolean;
}> = {
  advance_gig_strategy: {
    relationshipTypes: ["promoter", "venue", "festival"],
    targetCountKey: "liveTargetCount",
  },
  advance_label_strategy: {
    relationshipTypes: ["label"],
    targetCountKey: "labelTargetCount",
  },
  advance_discovery: {
    relationshipTypes: ["playlist", "channel"],
    growthKinds: ["catalog_revival", "content_breakout"],
  },
  advance_fan_growth: {
    growthKinds: ["funnel_bottleneck", "content_breakout", "catalog_revival"],
  },
  advance_release_strategy: {
    growthKinds: ["release_risk", "release_candidate"],
    releasePlan: true,
  },
  advance_owned_audience: {
    ownedAudience: true,
  },
};

type PreparationSource = {
  source: "scene" | "growth_scan" | "release_plan" | "owned_audience";
  prepared: number;
  reason: string;
};

type ManagerPreparationResult = {
  prepared: number;
  sources: PreparationSource[];
  reason: "manager_preparation_completed" | "no_actionable_work";
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

  const internalEngineAvailable = Boolean(config.releasePlan || config.growthKinds?.length || config.ownedAudience);
  if (!internalEngineAvailable && config.targetCountKey) {
    return Number(payload[config.targetCountKey] ?? 0) > 0;
  }
  return true;
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

async function prepareSceneTargets({
  action,
  relationshipTypes,
}: {
  action: { owner_id: string; artist_id: string };
  relationshipTypes: ArtistSceneRelationshipType[];
}): Promise<PreparationSource> {
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
  if (!artistResult.data) return { source: "scene", prepared: 0, reason: "artist_not_active" };

  const allowedTypes = new Set<ArtistSceneRelationshipType>(relationshipTypes);
  const relationships = usableSceneRelationships(
    (relationshipsResult.data ?? []).map(mappedRelationship),
  ).filter((relationship) =>
    allowedTypes.has(relationship.type)
    && relationship.status !== "candidate"
    && relationship.fitScore >= 60
    && relationship.confidence >= 0.35,
  );
  if (!relationships.length) return { source: "scene", prepared: 0, reason: "no_verified_targets" };

  const result = await materializeSceneGrowthOpportunities({
    client: autonomy as unknown as SupabaseClient<Database>,
    ownerId: action.owner_id,
    artistId: action.artist_id,
    artistName: artistResult.data.name,
    relationships,
    includeSceneMapFallback: false,
  });
  return {
    source: "scene",
    prepared: result.actionablePrepared,
    reason: result.actionablePrepared > 0 ? "scene_opportunities_prepared" : "scene_targets_already_resolved",
  };
}

async function executeManagerPreparation(action: {
  owner_id: string;
  artist_id: string;
  action_type: string;
}): Promise<ManagerPreparationResult> {
  const config = SAFE_MANAGER_ACTIONS[action.action_type];
  if (!config) return { prepared: 0, sources: [], reason: "no_actionable_work" };
  const autonomy = createAutonomyServiceClient();
  const client = autonomy as unknown as SupabaseClient<Database>;
  const sources: PreparationSource[] = [];

  if (config.relationshipTypes?.length) {
    sources.push(await prepareSceneTargets({ action, relationshipTypes: config.relationshipTypes }));
  }

  if (config.growthKinds?.length) {
    const growth = await prepareDetectedGrowthOpportunities({
      client,
      ownerId: action.owner_id,
      artistId: action.artist_id,
      kinds: config.growthKinds,
      respectCatalogEngine: true,
    });
    sources.push({ source: "growth_scan", prepared: growth.prepared, reason: growth.reason });
  }

  if (config.releasePlan) {
    const release = await prepareReleaseGrowthPlan({
      client,
      ownerId: action.owner_id,
      artistId: action.artist_id,
      respectAutoplan: true,
    });
    sources.push({ source: "release_plan", prepared: release.prepared, reason: release.reason });
  }

  if (config.ownedAudience) {
    const ownedAudience = await prepareOwnedAudienceOpportunity({
      client,
      ownerId: action.owner_id,
      artistId: action.artist_id,
    });
    sources.push({
      source: "owned_audience",
      prepared: ownedAudience.prepared,
      reason: ownedAudience.reason,
    });
  }

  const prepared = sources.reduce((sum, source) => sum + source.prepared, 0);
  return {
    prepared,
    sources,
    reason: prepared > 0 ? "manager_preparation_completed" : "no_actionable_work",
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
  let prepared = 0;
  let noOp = 0;
  let failed = 0;

  for (const candidate of eligible) {
    const action = await claimAction(candidate);
    if (!action) continue;
    claimed += 1;
    const payload = record(action.payload);

    try {
      const result = await executeManagerPreparation(action);
      const completedAt = new Date().toISOString();
      const finalStatus = result.prepared > 0 ? "completed" as const : "dismissed" as const;
      const { error: completeError } = await autonomy.from("next_best_actions").update({
        status: finalStatus,
        payload: asJson({
          ...payload,
          managerExecution: {
            outcome: result.reason,
            completedAt,
            prepared: result.prepared,
            sources: result.sources,
            systemNoOp: result.prepared === 0,
          },
        }),
      }).eq("id", action.id).eq("owner_id", action.owner_id).eq("artist_id", action.artist_id).eq("status", "executing");
      if (completeError) throw new Error(completeError.message);
      if (result.prepared > 0) {
        completed += 1;
        prepared += result.prepared;
      } else {
        noOp += 1;
      }
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
    prepared,
    noOp,
    failed,
  };
}
