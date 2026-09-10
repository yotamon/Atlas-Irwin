"use server";

import { revalidatePath } from "next/cache";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  AUTONOMY_DOMAINS,
  type AutonomyDomain,
  type AutonomyMode,
} from "@/lib/autonomy/domain";
import { upsertArtistAutonomyContract } from "@/lib/autonomy/server";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";

const MODES = new Set<AutonomyMode>(["assist", "prepare", "run"]);

function stringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalMoney(formData: FormData, key: string) {
  const raw = stringValue(formData, key);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be a non-negative amount.`);
  return Math.round(value * 10_000) / 10_000;
}

function listValue(formData: FormData, key: string) {
  return stringValue(formData, key)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 30);
}

function optionalExpiry(formData: FormData) {
  const raw = stringValue(formData, "expires_at");
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid autonomy contract expiry.");
  if (parsed.getTime() <= Date.now()) throw new Error("Autonomy contract expiry must be in the future.");
  return parsed.toISOString();
}

export async function saveAutonomyContract(formData: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const domain = stringValue(formData, "domain") as AutonomyDomain;
  const mode = stringValue(formData, "mode") as AutonomyMode;
  if (!AUTONOMY_DOMAINS.includes(domain)) throw new Error("Unsupported autonomy domain.");
  if (!MODES.has(mode)) throw new Error("Unsupported autonomy mode.");

  const maxSingleSpendUsd = optionalMoney(formData, "max_single_spend_usd");
  const maxTotalSpendUsd = optionalMoney(formData, "max_total_spend_usd");
  if (maxSingleSpendUsd != null && maxTotalSpendUsd != null && maxSingleSpendUsd > maxTotalSpendUsd) {
    throw new Error("The per-action spend ceiling cannot exceed the total contract ceiling.");
  }

  await upsertArtistAutonomyContract({
    db: supabase,
    ownerId: user.id,
    artistId: artist.artistId,
    domain,
    mode,
    enabled: formData.get("enabled") === "on",
    maxSingleSpendUsd,
    maxTotalSpendUsd,
    allowedProviders: listValue(formData, "allowed_providers"),
    allowedPlatforms: listValue(formData, "allowed_platforms"),
    expiresAt: optionalExpiry(formData),
  });

  revalidatePath("/studio/settings/autonomy");
  revalidatePath("/studio/settings");
  revalidatePath("/studio");
}
