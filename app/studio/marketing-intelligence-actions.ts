"use server";

import { buildCampaignIntelligence } from "@/lib/marketing/marketing-intelligence-build";
import { persistCampaignIntelligence } from "@/lib/marketing/marketing-intelligence-persist";
import {
  approveIntelligentVariantImpl,
  rejectIntelligentVariantImpl,
} from "@/lib/marketing/marketing-intelligence-feedback-runtime";

export async function refreshCampaignIntelligence(form: FormData) {
  const built = await buildCampaignIntelligence(form);
  await persistCampaignIntelligence(built);
}

export async function approveIntelligentVariant(form: FormData) {
  await approveIntelligentVariantImpl(form);
}

export async function rejectIntelligentVariant(form: FormData) {
  await rejectIntelligentVariantImpl(form);
}
