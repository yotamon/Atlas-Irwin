export const ENTITLEMENT_SET_VERSION = "ensemblis.entitlement-set.v1" as const;

export const PLATFORM_CAPABILITIES = [
  "local.processing",
  "local.advanced_models",
  "cloud.sync",
  "cloud.storage",
  "cloud.compute",
  "cloud.ai",
  "collaboration.projects",
  "collaboration.comments",
  "promotion.integrations",
] as const;

export type PlatformCapability = string;

export type EntitlementSet = {
  version: typeof ENTITLEMENT_SET_VERSION;
  subjectId: string;
  capabilities: PlatformCapability[];
  issuedAt: string;
  expiresAt?: string | null;
  offlineGraceUntil?: string | null;
};

export function activeCapabilities(entitlements: EntitlementSet, now = new Date()): ReadonlySet<string> {
  const expiry = entitlements.expiresAt ? Date.parse(entitlements.expiresAt) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(expiry) && entitlements.expiresAt) return new Set();
  if (now.getTime() > expiry) return new Set();
  return new Set(entitlements.capabilities);
}
