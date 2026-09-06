import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/types/database";
import type { EnsemblisDatabase } from "@/types/ensemblis-database";
import { createAutonomyServiceClient } from "./autonomy-db";
import { createMarketingServiceClient } from "./db";

export type AutonomyArtistScope = { ownerId: string; artistId: string };

function asJson(value: unknown) {
  return value as Json;
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function operatingSchemaMissing(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("artist_operating_profiles")
    || normalized.includes("artist_scene_relationships")
    || (normalized.includes("schema cache") && normalized.includes("artist_"));
}

async function artistScopes() {
  const autonomy = createAutonomyServiceClient();
  const marketing = createMarketingServiceClient();
  const operating = autonomy as unknown as SupabaseClient<EnsemblisDatabase>;
  const [artists, workspaces, audience, opportunities, publications, campaigns] = await Promise.all([
    operating.from("artists").select("id,workspace_id,legacy_owner_id,status").eq("status", "active").limit(500),
    operating.from("workspaces").select("id,created_by,legacy_owner_id").limit(500),
    autonomy.from("audience_interactions").select("owner_id,artist_id").limit(500),
    autonomy.from("marketing_opportunities").select("owner_id,artist_id").limit(500),
    marketing.from("publication_jobs").select("owner_id,artist_id").limit(500),
    marketing.from("campaigns").select("owner_id,artist_id").in("status", ["draft", "planned", "active"]).limit(500),
  ]);
  const error = artists.error || workspaces.error || audience.error || opportunities.error || publications.error || campaigns.error;
  if (error) throw new Error(error.message);

  const unique = new Map<string, AutonomyArtistScope>();
  const workspaceOwner = new Map(
    (workspaces.data ?? []).map((workspace) => [workspace.id, workspace.legacy_owner_id ?? workspace.created_by]),
  );
  for (const artist of artists.data ?? []) {
    const ownerId = artist.legacy_owner_id ?? workspaceOwner.get(artist.workspace_id) ?? null;
    if (!ownerId) continue;
    unique.set(`${ownerId}:${artist.id}`, { ownerId, artistId: artist.id });
  }
  for (const row of [
    ...(audience.data ?? []),
    ...(opportunities.data ?? []),
    ...(publications.data ?? []),
    ...(campaigns.data ?? []),
  ]) {
    if (!row.artist_id) continue;
    unique.set(`${row.owner_id}:${row.artist_id}`, { ownerId: row.owner_id, artistId: row.artist_id });
  }
  return [...unique.values()];
}

async function propose(scope: AutonomyArtistScope, input: {
  actionType: string;
  title: string;
  rationale: string;
  score: number;
  sourceType?: string | null;
  sourceId?: string | null;
  payload?: unknown;
  key: string;
  expiresAt?: string | null;
}) {
  const db = createAutonomyServiceClient();
  const { error } = await db.from("next_best_actions").upsert({
    owner_id: scope.ownerId,
    artist_id: scope.artistId,
    action_type: input.actionType,
    title: input.title,
    rationale: input.rationale,
    score: Math.max(0, Math.min(100, input.score)),
    source_type: input.sourceType ?? null,
    source_id: input.sourceId ?? null,
    payload: asJson(input.payload ?? {}),
    idempotency_key: `${dayKey()}:${input.key}`,
    status: "proposed",
    expires_at: input.expiresAt ?? new Date(Date.now() + 3 * 86_400_000).toISOString(),
  }, { onConflict: "artist_id,idempotency_key" });
  if (error) throw new Error(error.message);
}

function managerGoalAction(input: {
  primaryGoal: string;
  marketingInvolvement: string;
  liveTargetCount: number;
  labelTargetCount: number;
}) {
  const managerOwned = input.marketingInvolvement === "just_make_music";
  const common = {
    sourceType: "artist_operating_profile",
    managerOwned,
    score: managerOwned ? 74 : 69,
  };

  if (input.primaryGoal === "get_gigs") {
    return {
      ...common,
      actionType: "advance_gig_strategy",
      title: input.liveTargetCount
        ? `Work the ${input.liveTargetCount} strongest live-scene target${input.liveTargetCount === 1 ? "" : "s"}`
        : "Build a real live-scene target map",
      rationale: input.liveTargetCount
        ? "Verified promoters, venues or festivals already fit this artist. Prioritize the strongest evidence before broad outreach."
        : "The goal is gigs, but there are not yet enough verified live-scene relationships. Ensemblis should improve the target map before asking the artist to cold-message strangers.",
    };
  }
  if (input.primaryGoal === "find_labels") {
    return {
      ...common,
      actionType: "advance_label_strategy",
      title: input.labelTargetCount
        ? `Work the ${input.labelTargetCount} strongest label target${input.labelTargetCount === 1 ? "" : "s"}`
        : "Build an evidence-backed label shortlist",
      rationale: input.labelTargetCount
        ? "There are verified label relationships worth prioritizing. Fit evidence should drive outreach order, not a generic label directory."
        : "The artist wants label or partner discovery. Ensemblis should establish real scene evidence before producing an outreach list.",
    };
  }
  if (input.primaryGoal === "release_music") {
    return {
      ...common,
      actionType: "advance_release_strategy",
      title: "Advance the next release mission",
      rationale: "Keep release readiness, creative preparation, distribution and launch work moving as one mission instead of making the artist manage separate tools.",
    };
  }
  if (input.primaryGoal === "build_owned_audience") {
    return {
      ...common,
      actionType: "advance_owned_audience",
      title: "Strengthen the owned-audience path",
      rationale: "Prioritize listener capture and repeat contact over adding more disconnected reach. Ensemblis should turn current attention into an audience the artist can reach again.",
    };
  }
  if (input.primaryGoal === "grow_fans") {
    return {
      ...common,
      actionType: "advance_fan_growth",
      title: "Turn current listeners into repeat fans",
      rationale: "Favor the strongest proven listener-to-follow, save and repeat-engagement path rather than increasing posting volume for its own sake.",
    };
  }
  return {
    ...common,
    actionType: "advance_discovery",
    title: "Focus discovery on the strongest current signal",
    rationale: "The primary goal is to get heard. Ensemblis should concentrate on the best-supported music, audience and scene signal instead of spreading effort across generic channels.",
  };
}

async function actionsForArtist(scope: AutonomyArtistScope) {
  const autonomy = createAutonomyServiceClient();
  const marketing = createMarketingServiceClient();
  const operating = autonomy as unknown as SupabaseClient<EnsemblisDatabase>;
  const [profileResult, relationshipsResult, audienceResult, opportunityResult, failedResult, overdueResult] = await Promise.all([
    operating.from("artist_operating_profiles")
      .select("artist_id,marketing_involvement,primary_goal")
      .eq("artist_id", scope.artistId)
      .maybeSingle(),
    operating.from("artist_scene_relationships")
      .select("id,relationship_type,fit_score,confidence,status")
      .eq("artist_id", scope.artistId)
      .in("status", ["verified", "contacted"])
      .order("fit_score", { ascending: false })
      .limit(40),
    autonomy.from("audience_interactions")
      .select("*")
      .eq("owner_id", scope.ownerId)
      .eq("artist_id", scope.artistId)
      .in("status", ["drafted", "needs_reply"])
      .order("occurred_at", { ascending: false })
      .limit(8),
    autonomy.from("marketing_opportunities")
      .select("*")
      .eq("owner_id", scope.ownerId)
      .eq("artist_id", scope.artistId)
      .eq("status", "new")
      .order("score", { ascending: false })
      .order("urgency", { ascending: false })
      .limit(8),
    marketing.from("publication_jobs")
      .select("id,platform,last_error,content_item_id,scheduled_at")
      .eq("owner_id", scope.ownerId)
      .eq("artist_id", scope.artistId)
      .eq("status", "failed")
      .order("updated_at", { ascending: false })
      .limit(5),
    marketing.from("publication_jobs")
      .select("id,platform,content_item_id,scheduled_at,status")
      .eq("owner_id", scope.ownerId)
      .eq("artist_id", scope.artistId)
      .in("status", ["awaiting_approval", "approved", "scheduled"])
      .lt("scheduled_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(5),
  ]);
  const profileError = profileResult.error && !operatingSchemaMissing(profileResult.error.message) ? profileResult.error : null;
  const relationshipsError = relationshipsResult.error && !operatingSchemaMissing(relationshipsResult.error.message) ? relationshipsResult.error : null;
  const error = profileError || relationshipsError || audienceResult.error || opportunityResult.error || failedResult.error || overdueResult.error;
  if (error) throw new Error(error.message);

  let created = 0;
  for (const publication of failedResult.data ?? []) {
    await propose(scope, {
      actionType: "repair_publication",
      title: `Fix failed ${publication.platform} publication`,
      rationale: publication.last_error || "A scheduled external publication exhausted its automatic retries.",
      score: 100,
      sourceType: "publication_job",
      sourceId: publication.id,
      payload: publication,
      key: `repair-publication:${publication.id}`,
    });
    created += 1;
  }

  for (const publication of overdueResult.data ?? []) {
    const needsApproval = publication.status === "awaiting_approval";
    await propose(scope, {
      actionType: needsApproval ? "approve_publication" : "publish_overdue",
      title: needsApproval ? `Review overdue ${publication.platform} post` : `Recover overdue ${publication.platform} post`,
      rationale: needsApproval
        ? "The planned publish time passed while this external action was waiting for approval."
        : "The publish window has passed; Ensemblis should retry it before creating more content.",
      score: needsApproval ? 96 : 98,
      sourceType: "publication_job",
      sourceId: publication.id,
      payload: publication,
      key: `overdue-publication:${publication.id}`,
    });
    created += 1;
  }

  for (const interaction of audienceResult.data ?? []) {
    const score = interaction.sentiment === "question" ? 94 : interaction.suggested_reply ? 86 : 78;
    await propose(scope, {
      actionType: "reply_to_listener",
      title: `Reply to ${interaction.author_name || interaction.author_handle || "a listener"} on ${interaction.platform}`,
      rationale: interaction.sentiment === "question"
        ? "A listener asked a direct question. Timely human replies are higher leverage than adding another generic post."
        : "Ensemblis identified a meaningful audience interaction worth acknowledging.",
      score,
      sourceType: "audience_interaction",
      sourceId: interaction.id,
      payload: { interactionId: interaction.id, platform: interaction.platform, hasDraft: Boolean(interaction.suggested_reply) },
      key: `audience:${interaction.id}`,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
    created += 1;
  }

  for (const opportunity of opportunityResult.data ?? []) {
    if (Number(opportunity.score) < 55) continue;
    const breakout = opportunity.kind === "breakout";
    await propose(scope, {
      actionType: breakout ? "derive_winner_content" : "inspect_trend_opportunity",
      title: breakout ? "Exploit a current artist breakout" : `Inspect: ${opportunity.title}`,
      rationale: breakout
        ? `${opportunity.summary} Reuse the winning framing while it is fresh, preferably from existing media at $0.`
        : `${opportunity.summary} The evidence is external; adapt only the format or insight if it fits this artist.`,
      score: Math.min(95, Number(opportunity.score) * 0.75 + Number(opportunity.urgency) * 0.25),
      sourceType: "marketing_opportunity",
      sourceId: opportunity.id,
      payload: { opportunityId: opportunity.id, kind: opportunity.kind, url: opportunity.url, recommendedAction: opportunity.recommended_action },
      key: `opportunity:${opportunity.id}`,
      expiresAt: opportunity.expires_at,
    });
    created += 1;
  }

  const profile = profileResult.error ? null : profileResult.data;
  if (profile) {
    const managerKey = `manager-goal:${profile.primary_goal}`;
    const managerIdempotencyKey = `${dayKey()}:${managerKey}`;
    const { data: existingManager, error: existingManagerError } = await autonomy.from("next_best_actions")
      .select("id,status")
      .eq("owner_id", scope.ownerId)
      .eq("artist_id", scope.artistId)
      .eq("idempotency_key", managerIdempotencyKey)
      .maybeSingle();
    if (existingManagerError) throw new Error(existingManagerError.message);

    const { error: retireError } = await autonomy.from("next_best_actions")
      .update({ status: "expired" })
      .eq("owner_id", scope.ownerId)
      .eq("artist_id", scope.artistId)
      .eq("status", "proposed")
      .eq("source_type", "artist_operating_profile")
      .neq("idempotency_key", managerIdempotencyKey);
    if (retireError) throw new Error(retireError.message);

    const terminalOrInFlight = existingManager
      && ["approved", "executing", "completed", "dismissed"].includes(existingManager.status);
    if (!terminalOrInFlight) {
      const trustedRelationships = (relationshipsResult.error ? [] : relationshipsResult.data ?? []).filter((relationship) =>
        Number(relationship.fit_score) >= 60 && Number(relationship.confidence) >= 0.35,
      );
      const liveTargetCount = trustedRelationships.filter((relationship) =>
        ["promoter", "venue", "festival"].includes(relationship.relationship_type),
      ).length;
      const labelTargetCount = trustedRelationships.filter((relationship) => relationship.relationship_type === "label").length;
      const manager = managerGoalAction({
        primaryGoal: profile.primary_goal,
        marketingInvolvement: profile.marketing_involvement,
        liveTargetCount,
        labelTargetCount,
      });
      await propose(scope, {
        actionType: manager.actionType,
        title: manager.title,
        rationale: manager.rationale,
        score: manager.score,
        sourceType: manager.sourceType,
        sourceId: scope.artistId,
        payload: {
          managerOwned: manager.managerOwned,
          primaryGoal: profile.primary_goal,
          marketingInvolvement: profile.marketing_involvement,
          liveTargetCount,
          labelTargetCount,
        },
        key: managerKey,
        expiresAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
      });
      created += 1;
    }
  }

  return created;
}

export async function refreshNextBestActions(scope?: AutonomyArtistScope) {
  const scopes = scope ? [scope] : await artistScopes();
  const db = createAutonomyServiceClient();
  let proposed = 0;
  for (const artistScope of scopes) proposed += await actionsForArtist(artistScope);

  let expireQuery = db.from("next_best_actions")
    .update({ status: "expired" })
    .eq("status", "proposed")
    .lt("expires_at", new Date().toISOString());
  if (scope) {
    expireQuery = expireQuery.eq("owner_id", scope.ownerId).eq("artist_id", scope.artistId);
  }
  const { error: expireError } = await expireQuery;
  if (expireError) throw new Error(expireError.message);

  return { artists: scopes.length, proposed };
}
