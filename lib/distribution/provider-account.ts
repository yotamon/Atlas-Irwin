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

function v1Base() {
  return (process.env.REVELATOR_API_V1_BASE_URL ?? "https://api.revelator.com").replace(/\/$/, "");
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

async function loginChild(partnerUserId: string) {
  const apiKey = partnerApiKey();
  if (!apiKey) throw new Error("Revelator partner API key is not configured for child-account authentication.");
  const raw = await jsonRequest(`${v1Base()}/partner/account/login`, {
    partnerUserId,
    partnerApiKey: apiKey,
  });
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const permissions = Array.isArray(record.permissions)
    ? record.permissions.filter((item): item is RevelatorLoginPermission => Boolean(item && typeof item === "object"))
    : [];
  const preferred = permissions.find((permission) => permission.isDefault === true) ?? permissions[0];
  const enterpriseId = Number(preferred?.enterpriseId);
  if (!Number.isFinite(enterpriseId) || enterpriseId <= 0) throw new Error("Child-account login succeeded without a usable enterprise ID.");
  return { raw, providerAccountId: String(enterpriseId) };
}

export async function ensureProviderClientAccount(input: {
  ownerId: string;
  email: string;
  enterpriseName: string;
}): Promise<ProviderClientAccount> {
  if (!childAccountProvisioningConfigured()) {
    throw new Error("Revelator child-account provisioning is not configured for this environment.");
  }
  const partnerUserId = input.ownerId;

  // A stable partnerUserId makes onboarding recoverable. Before creating anything, try to
  // recover an existing child account from a previous partially persisted signup.
  try {
    const existing = await loginChild(partnerUserId);
    return {
      providerAccountId: existing.providerAccountId,
      providerUserId: null,
      partnerUserId,
      raw: existing.raw,
      recovered: true,
    };
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
    const raw = await jsonRequest(`${v1Base()}/partner/account/signup`, signupBody);
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
    // Network ambiguity or a duplicate signup can leave the child created even though the
    // caller saw an error. Recover through unprompted login before surfacing failure.
    try {
      const recovered = await loginChild(partnerUserId);
      return {
        providerAccountId: recovered.providerAccountId,
        providerUserId: null,
        partnerUserId,
        raw: recovered.raw,
        recovered: true,
      };
    } catch {
      throw signupError;
    }
  }
}

export function providerForDistributionAccount(account: DistributionAccount | null | undefined): DistributionProvider {
  const metadata = object(account?.provider_metadata);
  const accountModel = metadata.accountModel === "child" ? "child" : "parent";
  const partnerUserId = typeof metadata.partnerUserId === "string" ? metadata.partnerUserId.trim() : "";
  if (accountModel === "child") {
    if (!partnerUserId) throw new Error("Distribution child account is missing its partner user context.");
    // Explicit empty token prevents a parent static token from overriding child-scoped login.
    return new RevelatorProvider({ token: "", partnerApiKey: partnerApiKey(), partnerUserId });
  }
  return getDistributionProvider();
}
