import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ArtistAutonomyContractRow } from "@/types/autonomy-contracts-database";
import {
  AUTONOMY_DOMAINS,
  type AutonomyContract,
  type AutonomyDecision,
  type AutonomyDomain,
  type AutonomyEffect,
  type AutonomyMode,
  resolveAutonomyDecision,
} from "./domain";
import { asAutonomyContractsClient, createAutonomyContractsServiceClient } from "./db";

function numberOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function autonomyContractFromRow(row: ArtistAutonomyContractRow): AutonomyContract {
  return {
    id: row.id,
    ownerId: row.owner_id,
    artistId: row.artist_id,
    domain: row.domain as AutonomyDomain,
    mode: row.mode as AutonomyMode,
    enabled: row.enabled,
    maxSingleSpendUsd: numberOrNull(row.max_single_spend_usd),
    maxTotalSpendUsd: numberOrNull(row.max_total_spend_usd),
    allowedProviders: row.allowed_providers ?? [],
    allowedPlatforms: row.allowed_platforms ?? [],
    expiresAt: row.expires_at,
  };
}

export async function loadArtistAutonomyContracts(input: {
  db: SupabaseClient<Database>;
  ownerId: string;
  artistId: string;
}) {
  const db = asAutonomyContractsClient(input.db);
  const result = await db
    .from("artist_autonomy_contracts")
    .select("*")
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .order("domain", { ascending: true });
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map(autonomyContractFromRow);
}

export async function loadArtistAutonomyContract(input: {
  db: SupabaseClient<Database>;
  ownerId: string;
  artistId: string;
  domain: AutonomyDomain;
}) {
  const db = asAutonomyContractsClient(input.db);
  const result = await db
    .from("artist_autonomy_contracts")
    .select("*")
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .eq("domain", input.domain)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data ? autonomyContractFromRow(result.data) : null;
}

export async function upsertArtistAutonomyContract(input: {
  db: SupabaseClient<Database>;
  ownerId: string;
  artistId: string;
  domain: AutonomyDomain;
  mode: AutonomyMode;
  enabled: boolean;
  maxSingleSpendUsd?: number | null;
  maxTotalSpendUsd?: number | null;
  allowedProviders?: string[];
  allowedPlatforms?: string[];
  expiresAt?: string | null;
}) {
  if (!AUTONOMY_DOMAINS.includes(input.domain)) throw new Error("Unsupported autonomy domain.");
  const db = asAutonomyContractsClient(input.db);
  const result = await db
    .from("artist_autonomy_contracts")
    .upsert({
      owner_id: input.ownerId,
      artist_id: input.artistId,
      domain: input.domain,
      mode: input.mode,
      enabled: input.enabled,
      max_single_spend_usd: input.maxSingleSpendUsd ?? null,
      max_total_spend_usd: input.maxTotalSpendUsd ?? null,
      allowed_providers: input.allowedProviders ?? [],
      allowed_platforms: input.allowedPlatforms ?? [],
      expires_at: input.expiresAt ?? null,
      created_by: input.ownerId,
    }, { onConflict: "owner_id,artist_id,domain" })
    .select("*")
    .single();
  if (result.error) throw new Error(result.error.message);
  return autonomyContractFromRow(result.data);
}

export async function resolveAndAuditAutonomyDecision(input: {
  ownerId: string;
  artistId: string;
  domain: AutonomyDomain;
  effect: AutonomyEffect;
  contract?: AutonomyContract | null;
  executionId?: string | null;
}): Promise<AutonomyDecision> {
  const decision = resolveAutonomyDecision({
    domain: input.domain,
    contract: input.contract ?? null,
    effect: input.effect,
  });
  const service = createAutonomyContractsServiceClient();
  const audit = await service.from("autonomy_decision_events").insert({
    owner_id: input.ownerId,
    artist_id: input.artistId,
    domain: input.domain,
    contract_id: decision.contractId,
    requested_action: input.effect.action.slice(0, 160),
    resolved_behavior: decision.behavior,
    reason: decision.reason.slice(0, 1000),
    contract_snapshot: decision.contract ? {
      id: decision.contract.id,
      domain: decision.contract.domain,
      mode: decision.contract.mode,
      enabled: decision.contract.enabled,
      maxSingleSpendUsd: decision.contract.maxSingleSpendUsd,
      maxTotalSpendUsd: decision.contract.maxTotalSpendUsd,
      allowedProviders: decision.contract.allowedProviders,
      allowedPlatforms: decision.contract.allowedPlatforms,
      expiresAt: decision.contract.expiresAt,
    } : {},
    effect_snapshot: {
      external: Boolean(input.effect.external),
      paid: Boolean(input.effect.paid),
      destructive: Boolean(input.effect.destructive),
      irreversible: Boolean(input.effect.irreversible),
      sensitiveCommunication: Boolean(input.effect.sensitiveCommunication),
      legalDeclaration: Boolean(input.effect.legalDeclaration),
      distributionSubmission: Boolean(input.effect.distributionSubmission),
      estimatedCostUsd: input.effect.estimatedCostUsd ?? null,
      currentContractSpendUsd: input.effect.currentContractSpendUsd ?? null,
      provider: input.effect.provider ?? null,
      platform: input.effect.platform ?? null,
    },
    execution_id: input.executionId ?? null,
  });
  if (audit.error) throw new Error(`Could not audit autonomy decision: ${audit.error.message}`);
  return decision;
}
