import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { asMarketingClient } from "@/lib/marketing/db";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { detectGrowthOpportunities, planReleaseQueue } from "@/lib/studio/growth";
import type { Database, Json } from "@/types/database";
import type { GrowthOpportunityKind, GrowthSettings } from "@/types/growth-database";

function json(value: unknown) {
  return value as Json;
}

const PRESERVED_OPPORTUNITY_STATUSES = new Set(["accepted", "dismissed", "completed"]);

async function ensureGrowthSettings(
  client: SupabaseClient<Database>,
  ownerId: string,
  artistId: string,
) {
  const growth = asGrowthClient(client);
  const { data, error } = await growth
    .from("artist_growth_settings")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data;

  const { data: created, error: createError } = await growth
    .from("artist_growth_settings")
    .insert({ owner_id: ownerId, artist_id: artistId })
    .select("*")
    .single();
  if (createError) throw new Error(createError.message);
  return created;
}

export async function prepareReleaseGrowthPlan({
  client,
  ownerId,
  artistId,
  respectAutoplan = true,
}: {
  client: SupabaseClient<Database>;
  ownerId: string;
  artistId: string;
  respectAutoplan?: boolean;
}) {
  const growth = asGrowthClient(client);
  const music = client;
  const settings = await ensureGrowthSettings(client, ownerId, artistId);
  if (respectAutoplan && !settings.autoplan_enabled) {
    return {
      prepared: 0,
      reason: "autoplan_disabled" as const,
      existingCommitted: 0,
    };
  }

  const [vaultResult, releasesResult, committedPlanResult] = await Promise.all([
    growth
      .from("track_vault")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .neq("status", "archived"),
    music
      .from("release_read_model")
      .select("id,release_date,status")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .in("status", ["Idea", "In Progress", "Scheduled"]),
    growth
      .from("growth_plan_items")
      .select("id,track_vault_id,target_date,status")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .in("status", ["accepted", "scheduled"]),
  ]);
  if (vaultResult.error) throw new Error(vaultResult.error.message);
  if (releasesResult.error) throw new Error(releasesResult.error.message);
  if (committedPlanResult.error) throw new Error(committedPlanResult.error.message);

  const committed = committedPlanResult.data ?? [];
  const committedTrackIds = new Set(
    committed.map((item) => item.track_vault_id).filter((id): id is string => Boolean(id)),
  );
  const tracks = (vaultResult.data ?? []).filter((track) => !committedTrackIds.has(track.id));
  const existingReleaseDates = [
    ...(releasesResult.data ?? []).map((release) => release.release_date),
    ...committed.map((item) => item.target_date),
  ].filter((date): date is string => Boolean(date));

  const plan = planReleaseQueue({
    tracks,
    existingReleaseDates,
    settings: settings as Pick<GrowthSettings, "planning_horizon_days" | "release_cadence_days" | "minimum_candidate_score">,
  });

  const { error: deleteError } = await growth
    .from("growth_plan_items")
    .delete()
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .eq("status", "proposed")
    .eq("source", "decision_engine");
  if (deleteError) throw new Error(deleteError.message);

  if (plan.length) {
    const { error: insertError } = await growth.from("growth_plan_items").insert(plan.map((item, index) => ({
      owner_id: ownerId,
      artist_id: artistId,
      track_vault_id: item.track.id,
      target_date: item.targetDate,
      sort_order: index,
      candidate_score: item.score,
      rationale: item.rationale,
      status: "proposed" as const,
      source: "decision_engine" as const,
    })));
    if (insertError) throw new Error(insertError.message);
  }

  return {
    prepared: plan.length,
    reason: plan.length ? "release_plan_prepared" as const : "no_release_candidates" as const,
    existingCommitted: committed.length,
  };
}

export async function prepareDetectedGrowthOpportunities({
  client,
  ownerId,
  artistId,
  kinds,
  respectCatalogEngine = true,
}: {
  client: SupabaseClient<Database>;
  ownerId: string;
  artistId: string;
  kinds?: GrowthOpportunityKind[];
  respectCatalogEngine?: boolean;
}) {
  const growth = asGrowthClient(client);
  const music = client;
  const marketing = asMarketingClient(client);
  const settings = await ensureGrowthSettings(client, ownerId, artistId);
  if (respectCatalogEngine && !settings.catalog_engine_enabled) {
    return {
      prepared: 0,
      detected: 0,
      created: 0,
      refreshed: 0,
      lifecyclePreserved: 0,
      reason: "catalog_engine_disabled" as const,
    };
  }

  const [vaultResult, releasesResult, metricsResult, contentResult, existingResult] = await Promise.all([
    growth
      .from("track_vault")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .neq("status", "archived"),
    music
      .from("release_read_model")
      .select("id,title,status,release_date")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId),
    marketing
      .from("metric_snapshots")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId),
    marketing
      .from("content_items")
      .select("id,release_id,title,status,asset_url")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId),
    growth
      .from("growth_opportunities")
      .select("id,dedupe_key,status")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId),
  ]);
  if (vaultResult.error) throw new Error(vaultResult.error.message);
  if (releasesResult.error) throw new Error(releasesResult.error.message);
  if (metricsResult.error) throw new Error(metricsResult.error.message);
  if (contentResult.error) throw new Error(contentResult.error.message);
  if (existingResult.error) throw new Error(existingResult.error.message);

  const allowedKinds = kinds?.length ? new Set<GrowthOpportunityKind>(kinds) : null;
  const drafts = detectGrowthOpportunities({
    releases: releasesResult.data ?? [],
    metrics: metricsResult.data ?? [],
    content: contentResult.data ?? [],
    vault: vaultResult.data ?? [],
  }).filter((draft) => !allowedKinds || allowedKinds.has(draft.kind));
  const existing = new Map((existingResult.data ?? []).map((item) => [item.dedupe_key, item]));

  let prepared = 0;
  let created = 0;
  let refreshed = 0;
  let lifecyclePreserved = 0;
  const detectedAt = new Date().toISOString();

  for (const draft of drafts) {
    const previous = existing.get(draft.dedupeKey);
    const preserveLifecycle = previous ? PRESERVED_OPPORTUNITY_STATUSES.has(previous.status) : false;
    const status = preserveLifecycle ? previous!.status : "new";
    const row = {
      owner_id: ownerId,
      artist_id: artistId,
      kind: draft.kind,
      release_id: draft.releaseId ?? null,
      track_vault_id: draft.trackVaultId ?? null,
      content_item_id: draft.contentItemId ?? null,
      title: draft.title,
      rationale: draft.rationale,
      priority: draft.priority,
      confidence: draft.confidence,
      evidence: json(draft.evidence),
      recommended_action: json(draft.recommendedAction),
      dedupe_key: draft.dedupeKey,
      status,
      detected_at: detectedAt,
    };

    if (previous) {
      const { error } = await growth
        .from("growth_opportunities")
        .update(row)
        .eq("id", previous.id)
        .eq("owner_id", ownerId)
        .eq("artist_id", artistId);
      if (error) throw new Error(error.message);
      refreshed += 1;
    } else {
      const { error } = await growth.from("growth_opportunities").insert(row);
      if (error) throw new Error(error.message);
      created += 1;
    }

    if (preserveLifecycle) lifecyclePreserved += 1;
    else prepared += 1;
  }

  return {
    prepared,
    detected: drafts.length,
    created,
    refreshed,
    lifecyclePreserved,
    reason: drafts.length ? "growth_opportunities_prepared" as const : "no_growth_signal" as const,
  };
}
