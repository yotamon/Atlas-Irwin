import "server-only";

import { createAutonomyServiceClient } from "./autonomy-db";
import { createMarketingServiceClient } from "./db";
import type { Json } from "@/types/database";

function asJson(value: unknown) {
  return value as Json;
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function ownerIds() {
  const autonomy = createAutonomyServiceClient();
  const marketing = createMarketingServiceClient();
  const [audience, opportunities, publications, campaigns] = await Promise.all([
    autonomy.from("audience_interactions").select("owner_id").limit(500),
    autonomy.from("marketing_opportunities").select("owner_id").limit(500),
    marketing.from("publication_jobs").select("owner_id").limit(500),
    marketing.from("campaigns").select("owner_id").in("status", ["draft", "planned", "active"]).limit(500),
  ]);
  const error = audience.error || opportunities.error || publications.error || campaigns.error;
  if (error) throw new Error(error.message);
  return Array.from(new Set([
    ...(audience.data ?? []).map((row) => row.owner_id),
    ...(opportunities.data ?? []).map((row) => row.owner_id),
    ...(publications.data ?? []).map((row) => row.owner_id),
    ...(campaigns.data ?? []).map((row) => row.owner_id),
  ]));
}

async function propose(ownerId: string, input: {
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
    owner_id: ownerId,
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
  }, { onConflict: "owner_id,idempotency_key" });
  if (error) throw new Error(error.message);
}

async function actionsForOwner(ownerId: string) {
  const autonomy = createAutonomyServiceClient();
  const marketing = createMarketingServiceClient();
  const [audienceResult, opportunityResult, failedResult, overdueResult] = await Promise.all([
    autonomy.from("audience_interactions")
      .select("*")
      .eq("owner_id", ownerId)
      .in("status", ["drafted", "needs_reply"])
      .order("occurred_at", { ascending: false })
      .limit(8),
    autonomy.from("marketing_opportunities")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("status", "new")
      .order("score", { ascending: false })
      .order("urgency", { ascending: false })
      .limit(8),
    marketing.from("publication_jobs")
      .select("id,platform,last_error,content_item_id,scheduled_at")
      .eq("owner_id", ownerId)
      .eq("status", "failed")
      .order("updated_at", { ascending: false })
      .limit(5),
    marketing.from("publication_jobs")
      .select("id,platform,content_item_id,scheduled_at,status")
      .eq("owner_id", ownerId)
      .in("status", ["awaiting_approval", "approved", "scheduled"])
      .lt("scheduled_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(5),
  ]);
  const error = audienceResult.error || opportunityResult.error || failedResult.error || overdueResult.error;
  if (error) throw new Error(error.message);

  let created = 0;
  for (const publication of failedResult.data ?? []) {
    await propose(ownerId, {
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
    await propose(ownerId, {
      actionType: needsApproval ? "approve_publication" : "publish_overdue",
      title: needsApproval ? `Review overdue ${publication.platform} post` : `Recover overdue ${publication.platform} post`,
      rationale: needsApproval
        ? "The planned publish time passed while this external action was waiting for approval."
        : "The publish window has passed; Atlas should retry it before creating more content.",
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
    await propose(ownerId, {
      actionType: "reply_to_listener",
      title: `Reply to ${interaction.author_name || interaction.author_handle || "a listener"} on ${interaction.platform}`,
      rationale: interaction.sentiment === "question"
        ? "A listener asked a direct question. Timely human replies are higher leverage than adding another generic post."
        : "Atlas identified a meaningful audience interaction worth acknowledging.",
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
    await propose(ownerId, {
      actionType: breakout ? "derive_winner_content" : "inspect_trend_opportunity",
      title: breakout ? "Exploit a current Atlas breakout" : `Inspect: ${opportunity.title}`,
      rationale: breakout
        ? `${opportunity.summary} Reuse the winning framing while it is fresh, preferably from existing media at $0.`
        : `${opportunity.summary} The evidence is external; adapt only the format or insight if it fits Atlas Irwin.`,
      score: Math.min(95, Number(opportunity.score) * 0.75 + Number(opportunity.urgency) * 0.25),
      sourceType: "marketing_opportunity",
      sourceId: opportunity.id,
      payload: { opportunityId: opportunity.id, kind: opportunity.kind, url: opportunity.url, recommendedAction: opportunity.recommended_action },
      key: `opportunity:${opportunity.id}`,
      expiresAt: opportunity.expires_at,
    });
    created += 1;
  }

  return created;
}

export async function refreshNextBestActions() {
  const owners = await ownerIds();
  const db = createAutonomyServiceClient();
  let proposed = 0;
  for (const ownerId of owners) proposed += await actionsForOwner(ownerId);

  const { error: expireError } = await db.from("next_best_actions")
    .update({ status: "expired" })
    .eq("status", "proposed")
    .lt("expires_at", new Date().toISOString());
  if (expireError) throw new Error(expireError.message);

  return { owners: owners.length, proposed };
}
