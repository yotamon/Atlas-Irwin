"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { lifecycleProviderForDistributionAccount } from "@/lib/distribution/provider-lifecycle";
import type { DistributionIssue } from "@/lib/distribution/domain";
import type { Json } from "@/types/database";
import type { DistributionDatabase } from "@/types/distribution-database";

type Db = SupabaseClient<DistributionDatabase>;

function bool(form: FormData, key: string) {
  return form.get(key) === "on" || form.get(key) === "true" || form.get(key) === "1";
}

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function json(value: unknown): Json {
  return value as Json;
}

function issueFingerprint(issue: DistributionIssue) {
  return createHash("sha256")
    .update([issue.code, issue.source, issue.storeId ?? "", issue.objectType ?? "", issue.objectId ?? "", issue.detail].join("|"))
    .digest("hex");
}

function providerErrorStatus(error: unknown) {
  return error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : null;
}

async function persistTakedownIssues(db: Db, ownerId: string, releaseId: string, issues: DistributionIssue[]) {
  const now = new Date().toISOString();
  const rows = issues.map((issue) => ({
    owner_id: ownerId,
    release_id: releaseId,
    fingerprint: issueFingerprint(issue),
    code: issue.code,
    title: issue.title,
    detail: issue.detail,
    severity: issue.severity,
    source: issue.source,
    object_type: issue.objectType ?? null,
    object_id: issue.objectId ?? null,
    store_id: issue.storeId ?? null,
    status: "open" as const,
    raw_issue: json(issue),
    last_seen_at: now,
    resolved_at: null,
    updated_at: now,
  }));
  if (!rows.length) return;
  const result = await db.from("distribution_validation_issues").upsert(rows, { onConflict: "release_id,fingerprint" });
  if (result.error) throw new Error(result.error.message);
}

export async function requestDistributionTakedown(form: FormData) {
  const releaseId = text(form, "release_id");
  if (!bool(form, "confirm_takedown")) throw new Error("Explicitly confirm the takedown before removing music from stores.");
  const requestedStoreIds = [...new Set(form.getAll("store_id").map(Number).filter(Number.isFinite))];
  if (!requestedStoreIds.length) throw new Error("Choose at least one delivered music service to take down.");

  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as Db;
  const [releaseResult, configResult, accountResult, deliveriesResult] = await Promise.all([
    db.from("releases").select("id,title").eq("id", releaseId).eq("owner_id", user.id).single(),
    db.from("release_distribution_configs").select("*").eq("release_id", releaseId).eq("owner_id", user.id).single(),
    db.from("distribution_accounts").select("*").eq("owner_id", user.id).eq("provider", "revelator").single(),
    db.from("distribution_deliveries").select("*").eq("release_id", releaseId).eq("owner_id", user.id),
  ]);
  for (const result of [releaseResult, configResult, accountResult, deliveriesResult]) if (result.error) throw new Error(result.error.message);
  const config = configResult.data;
  const account = accountResult.data;
  if (!config.provider_release_id) throw new Error("This release has no provider catalog record to take down.");
  if (!["delivered", "partially_live", "live", "error", "rejected"].includes(config.state)) throw new Error(`A takedown cannot be started while the release is '${config.state}'.`);

  const deliveries = deliveriesResult.data ?? [];
  const eligible = deliveries.filter((delivery) => ["delivered", "live", "error", "rejected"].includes(delivery.state));
  const eligibleIds = new Set(eligible.map((delivery) => Number(delivery.store_id)).filter(Number.isFinite));
  const storeIds = requestedStoreIds.filter((id) => eligibleIds.has(id));
  if (storeIds.length !== requestedStoreIds.length) throw new Error("One or more selected services are not currently eligible for a takedown.");

  const lifecycle = lifecycleProviderForDistributionAccount(account);
  const validation = await lifecycle.validateTakedown(config.provider_release_id, storeIds);
  if (!validation.ready) {
    await persistTakedownIssues(db, user.id, releaseId, validation.issues);
    throw new Error("The provider rejected the takedown dry run. Resolve the reported store requirements before removing the release.");
  }

  const storeHash = createHash("sha256").update([...storeIds].sort((a, b) => a - b).join(",")).digest("hex").slice(0, 16);
  const operationKey = `takedown:${releaseId}:${storeHash}`;
  const existingResult = await db.from("distribution_provider_operations").select("*").eq("owner_id", user.id).eq("provider", config.provider).eq("operation_key", operationKey).maybeSingle();
  if (existingResult.error) throw new Error(existingResult.error.message);
  const existing = existingResult.data;
  if (existing?.state === "completed") throw new Error("This takedown request has already been sent. Refresh distribution status instead of sending it again.");
  if (existing && ["started", "ambiguous"].includes(existing.state)) throw new Error("A previous takedown has an unresolved provider result. Ensemblis will not retry it automatically.");

  const now = new Date().toISOString();
  const requestSnapshot = json({ releaseId, providerReleaseId: config.provider_release_id, storeIds, validation: validation.raw });
  if (existing) {
    const restart = await db.from("distribution_provider_operations").update({ state: "started", request_snapshot: requestSnapshot, result_snapshot: {}, error: null, started_at: now, completed_at: null }).eq("id", existing.id).eq("owner_id", user.id);
    if (restart.error) throw new Error(restart.error.message);
  } else {
    const start = await db.from("distribution_provider_operations").insert({
      owner_id: user.id,
      release_id: releaseId,
      provider: config.provider,
      operation_type: "takedown",
      operation_key: operationKey,
      state: "started",
      request_snapshot: requestSnapshot,
      provider_resource_id: config.provider_release_id,
    });
    if (start.error) throw new Error(start.error.message);
  }

  try {
    const raw = await lifecycle.takedownRelease(config.provider_release_id, storeIds);
    const completedAt = new Date().toISOString();
    const operation = await db.from("distribution_provider_operations").update({ state: "completed", result_snapshot: json(raw ?? { accepted: true }), completed_at: completedAt }).eq("owner_id", user.id).eq("provider", config.provider).eq("operation_key", operationKey);
    if (operation.error) throw new Error(operation.error.message);
    const configUpdate = await db.from("release_distribution_configs").update({ state: "takedown_pending", last_synced_at: completedAt }).eq("release_id", releaseId).eq("owner_id", user.id);
    if (configUpdate.error) throw new Error(configUpdate.error.message);
    const deliveryUpdate = await db.from("distribution_deliveries").update({ state: "takedown_pending", last_synced_at: completedAt, updated_at: completedAt }).eq("release_id", releaseId).eq("owner_id", user.id).in("store_id", storeIds.map(String));
    if (deliveryUpdate.error) throw new Error(deliveryUpdate.error.message);
    const event = await db.from("distribution_events").insert({ owner_id: user.id, release_id: releaseId, submission_id: null, event_type: "distribution.takedown_requested", actor_type: "artist", provider: config.provider, payload: json({ storeIds }) });
    if (event.error) throw new Error(event.error.message);
  } catch (error) {
    const status = providerErrorStatus(error);
    const safeFailure = status != null && status >= 400 && status < 500;
    await db.from("distribution_provider_operations").update({ state: safeFailure ? "failed_safe" : "ambiguous", error: error instanceof Error ? error.message : "Unknown provider takedown error", completed_at: safeFailure ? new Date().toISOString() : null }).eq("owner_id", user.id).eq("provider", config.provider).eq("operation_key", operationKey);
    if (!safeFailure) {
      await db.from("release_distribution_configs").update({ state: "error" }).eq("release_id", releaseId).eq("owner_id", user.id);
      throw new Error("The takedown result is ambiguous. Ensemblis will not retry automatically; reconcile provider status before another destructive action.");
    }
    throw error;
  }

  revalidatePath("/studio/distribution");
  revalidatePath("/studio/distribution/operations");
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath(`/studio/releases/${releaseId}/distribution`);
}
