"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  childAccountProvisioningConfigured,
  distributionAccountModel,
  ensureProviderClientAccount,
} from "@/lib/distribution/provider-account";
import type { Json } from "@/types/database";
import type { DistributionDatabase } from "@/types/distribution-database";

type Db = SupabaseClient<DistributionDatabase>;

function bool(form: FormData, key: string) {
  return form.get(key) === "on" || form.get(key) === "true" || form.get(key) === "1";
}

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function asJson(value: unknown): Json {
  return value as Json;
}

export async function saveDistributionAccount(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as Db;
  const legalName = text(form, "legal_name");
  const countryCode = text(form, "country_code").toUpperCase();
  if (!legalName || !/^[A-Z]{2}$/.test(countryCode)) throw new Error("Legal name and a two-letter country code are required.");
  if (!bool(form, "agreement_accepted") || !bool(form, "rights_terms_accepted")) throw new Error("Distribution and rights terms must be explicitly accepted.");

  const existingResult = await db.from("distribution_accounts")
    .select("*")
    .eq("owner_id", user.id)
    .eq("provider", "revelator")
    .maybeSingle();
  if (existingResult.error) throw new Error(existingResult.error.message);
  const existing = existingResult.data;
  const now = new Date().toISOString();
  const model = distributionAccountModel();

  const localWrite = await db.from("distribution_accounts").upsert({
    owner_id: user.id,
    provider: "revelator",
    provider_account_id: existing?.provider_account_id ?? null,
    legal_name: legalName,
    country_code: countryCode,
    agreement_accepted_at: existing?.agreement_accepted_at ?? now,
    rights_terms_accepted_at: existing?.rights_terms_accepted_at ?? now,
    status: existing?.status && !["setup_required", "restricted", "suspended"].includes(existing.status) ? existing.status : "pending_verification",
    kyc_status: existing?.kyc_status ?? "pending",
    payout_status: existing?.payout_status ?? "pending",
    provider_metadata: existing?.provider_metadata ?? asJson({ accountModel: model }),
  }, { onConflict: "owner_id,provider" });
  if (localWrite.error) throw new Error(localWrite.error.message);

  let providerAccountId = existing?.provider_account_id ?? null;
  let providerMetadata: Json = existing?.provider_metadata ?? asJson({ accountModel: model });

  if (model === "child" && !providerAccountId) {
    if (!childAccountProvisioningConfigured()) {
      throw new Error("Distribution onboarding is saved, but Revelator child-account provisioning is not enabled for this environment.");
    }
    if (!user.email) throw new Error("Your Ensemblis account needs an email address before a distribution child account can be created.");

    try {
      const provisioned = await ensureProviderClientAccount({
        ownerId: user.id,
        email: user.email,
        enterpriseName: legalName,
      });
      providerAccountId = provisioned.providerAccountId;
      providerMetadata = asJson({
        accountModel: "child",
        partnerUserId: provisioned.partnerUserId,
        providerUserId: provisioned.providerUserId,
        provisionedAt: now,
        recoveredProvisioning: provisioned.recovered,
      });
      const providerWrite = await db.from("distribution_accounts").update({
        provider_account_id: providerAccountId,
        provider_metadata: providerMetadata,
        status: "pending_verification",
      }).eq("owner_id", user.id).eq("provider", "revelator");
      if (providerWrite.error) {
        throw new Error(`The provider child account exists as ${providerAccountId}, but Ensemblis could not persist the reference. Retry onboarding to recover it safely. ${providerWrite.error.message}`);
      }
    } catch (error) {
      const failureWrite = await db.from("distribution_accounts").update({
        provider_metadata: asJson({
          accountModel: "child",
          partnerUserId: user.id,
          provisioningError: error instanceof Error ? error.message : "Unknown provider onboarding error",
          provisioningFailedAt: now,
        }),
      }).eq("owner_id", user.id).eq("provider", "revelator");
      if (failureWrite.error) throw new Error(`${error instanceof Error ? error.message : "Provider onboarding failed."} Ensemblis also failed to record the recovery state: ${failureWrite.error.message}`);
      throw error;
    }
  } else if (model === "parent") {
    providerMetadata = asJson({ accountModel: "parent" });
    const parentWrite = await db.from("distribution_accounts").update({ provider_metadata: providerMetadata }).eq("owner_id", user.id).eq("provider", "revelator");
    if (parentWrite.error) throw new Error(parentWrite.error.message);
  }

  const event = await db.from("distribution_events").insert({
    owner_id: user.id,
    release_id: null,
    submission_id: null,
    event_type: providerAccountId ? "distribution.account_provider_provisioned" : "distribution.account_terms_confirmed",
    actor_type: "artist",
    provider: "revelator",
    payload: asJson({ countryCode, accountModel: model, providerAccountProvisioned: Boolean(providerAccountId) }),
  });
  if (event.error) throw new Error(event.error.message);

  revalidatePath("/studio/distribution");
  revalidatePath("/studio/distribution/operations");
}
