import { randomBytes } from "node:crypto";
import type { Json } from "@/types/database";
import type { DistributionAccount } from "@/types/distribution-database";
import { getDistributionProvider, RevelatorProvider, type DistributionProvider } from "./provider";

export type ProviderClientAccount = {
  providerAccountId: string;
  providerUserId: string | null;
  partnerUserId: string;
  raw: unknown;
  recovered: boolean;
};

type RevelatorLoginPermission = {
  enterpriseId?: unknown;
  isDefault?: unknown;
  email?: unknown;
};

type RevelatorLogin = {
  raw: unknown;
  providerAccountId: string;
  accessToken: string;
};

function object(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function responseMessage(body: unknown, status: number) {
  if (body && typeof body === "object" && "title" in body) return String((body as { title?: unknown }).title);
  if (body && typeof body === "object" && "message" in body) return String((body as { message?: unknown }).message);
  if (body && typeof body === "object" && "error" in body) return String((body as { error?: unknown }).error);
  return `Distribution account request failed (${status}).`;
}

async function jsonRequest(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!response.ok) {
    const error = new Error(responseMessage(parsed, response.status)) as Error & { status?: number; body?: unknown };
    error.status = response.status;
    error.body = parsed;
    throw error;
  }
  return parsed;
}

function partnerApiKey() {
  return process.env.REVELATOR_PARTNER_API_KEY?.trim() ?? "";
}

export function revelatorV1Base() {
  return (process.env.REVELATOR_API_V1_BASE_URL ?? "https://api.revelator.com").replace(/\/$/, "");
}

export function revelatorV2Base() {
  return (process.env.REVELATOR_API_V2_BASE_URL ?? "https://platform.revelator.com").replace(/\/$/, "");
}

export function distributionAccountModel() {
  const explicit = process.env.REVELATOR_ACCOUNT_MODEL?.trim().toLowerCase();
  if (explicit === "parent" || explicit === "standalone") return "parent" as const;
  if (explicit === "child") return "child" as const;
  return partnerApiKey() ? "child" as const : "parent" as const;
}

export function childAccountProvisioningConfigured() {
  return distributionAccountModel() === "child" && Boolean(partnerApiKey());
}

async function loginPartnerUser(partnerUserId: string): Promise<RevelatorLogin> {
  const apiKey = partnerApiKey();
  if (!apiKey) throw new Error("Revelator partner API key is not configured for partner authentication.");
  const raw = await jsonRequest(`${revelatorV1Base()}/partner/account/login`, {
    partnerUserId,
    partnerApiKey: apiKey,
  });
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const accessToken = String(record.accessToken ?? "").trim();
  if (!accessToken) throw new Error("Provider login succeeded without an access token.");
  const permissions = Array.isArray(record.permissions)
    ? record.permissions.filter((item): item is RevelatorLoginPermission => Boolean(item && typeof item === "object"))
    : [];
  const preferred = permissions.find((permission) => permission.isDefault === true) ?? permissions[0];
  const enterpriseId = Number(preferred?.enterpriseId);
  if (!Number.isFinite(enterpriseId) || enterpriseId <= 0) throw new Error("Provider login succeeded without a usable enterprise ID.");
  return { raw, providerAccountId: String(enterpriseId), accessToken };
}

// Compatibility name for the original child-account recovery contract. Recovery still uses
// the same stable partner user identity; loginChild(partnerUserId) delegates to the shared login.
async function loginChild(partnerUserId: string) {
  return loginPartnerUser(partnerUserId);
}

export async function ensureProviderClientAccount(input: {
  ownerId: string;
  email: string;
  enterpriseName: string;
}): Promise<ProviderClientAccount> {
  if (!childAccountProvisioningConfigured()) throw new Error("Revelator child-account provisioning is not configured for this environment.");
  const partnerUserId = input.ownerId;

  try {
    const existing = await loginChild(partnerUserId);
    return { providerAccountId: existing.providerAccountId, providerUserId: null, partnerUserId, raw: existing.raw, recovered: true };
  } catch {
    // No recoverable child was found. Signup below uses the same stable partnerUserId.
  }

  const signupBody = {
    email: input.email,
    password: randomBytes(32).toString("base64url"),
    enterpriseName: input.enterpriseName,
    type: "Growth",
    partnerAPIKey: partnerApiKey(),
    partnerUserId,
  };

  try {
    const raw = await jsonRequest(`${revelatorV1Base()}/partner/account/signup`, signupBody);
    const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const enterpriseId = Number(record.enterpriseId);
    if (!Number.isFinite(enterpriseId) || enterpriseId <= 0) throw new Error("Child-account signup succeeded without a usable enterprise ID.");
    return {
      providerAccountId: String(enterpriseId),
      providerUserId: record.userId == null ? null : String(record.userId),
      partnerUserId,
      raw,
      recovered: false,
    };
  } catch (signupError) {
    try {
      const recovered = await loginChild(partnerUserId);
      return { providerAccountId: recovered.providerAccountId, providerUserId: null, partnerUserId, raw: recovered.raw, recovered: true };
    } catch {
      throw signupError;
    }
  }
}

export async function accessTokenForDistributionAccount(account: DistributionAccount | null | undefined) {
  const metadata = object(account?.provider_metadata);
  if (metadata.accountModel === "child") {
    const partnerUserId = typeof metadata.partnerUserId === "string" ? metadata.partnerUserId.trim() : "";
    if (!partnerUserId) throw new Error("Distribution child account is missing its partner user context.");
    return (await loginPartnerUser(partnerUserId)).accessToken;
  }

  const staticToken = process.env.REVELATOR_ACCESS_TOKEN?.trim();
  if (staticToken) return staticToken;
  const partnerUserId = process.env.REVELATOR_PARTNER_USER_ID?.trim();
  if (!partnerUserId) throw new Error("Distribution provider authentication is not configured for the parent account.");
  return (await loginPartnerUser(partnerUserId)).accessToken;
}

export function providerForDistributionAccount(account: DistributionAccount | null | undefined): DistributionProvider {
  const metadata = object(account?.provider_metadata);
  const accountModel = metadata.accountModel === "child" ? "child" : "parent";
  const partnerUserId = typeof metadata.partnerUserId === "string" ? metadata.partnerUserId.trim() : "";
  if (accountModel === "child") {
    if (!partnerUserId) throw new Error("Distribution child account is missing its partner user context.");
    return new RevelatorProvider({ token: "", partnerApiKey: partnerApiKey(), partnerUserId });
  }
  return getDistributionProvider();
}
