export const ENTITLEMENT_SET_VERSION = "ensemblis.entitlement-set.v1" as const;
export const SIGNED_ENTITLEMENT_CLAIMS_VERSION = "ensemblis.signed-entitlement-claims.v1" as const;

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
export type LicenseKind = "studio_perpetual_v1" | "account";

export type EntitlementSet = {
  version: typeof ENTITLEMENT_SET_VERSION;
  subjectId: string;
  capabilities: PlatformCapability[];
  issuedAt: string;
  expiresAt?: string | null;
  offlineGraceUntil?: string | null;
};

export type SignedEntitlementClaims = {
  version: typeof SIGNED_ENTITLEMENT_CLAIMS_VERSION;
  subjectId: string;
  deviceId: string;
  capabilities: PlatformCapability[];
  offlineCapabilities: PlatformCapability[];
  issuedAt: string;
  expiresAt: string;
  offlineGraceUntil: string;
  license: {
    kind: LicenseKind | null;
    majorVersion: number | null;
  };
};

export type EffectiveEntitlementState = {
  mode: "online" | "offline_grace" | "expired";
  capabilities: ReadonlySet<string>;
};

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function activeCapabilities(entitlements: EntitlementSet, now = new Date()): ReadonlySet<string> {
  const expiry = entitlements.expiresAt ? timestamp(entitlements.expiresAt) : Number.POSITIVE_INFINITY;
  if (expiry == null) return new Set();
  if (now.getTime() > expiry) return new Set();
  return new Set(entitlements.capabilities);
}

export function effectiveSignedCapabilities(
  claims: SignedEntitlementClaims,
  now = new Date(),
): EffectiveEntitlementState {
  const expiresAt = timestamp(claims.expiresAt);
  const offlineGraceUntil = timestamp(claims.offlineGraceUntil);
  if (expiresAt == null || offlineGraceUntil == null || offlineGraceUntil < expiresAt) {
    return { mode: "expired", capabilities: new Set() };
  }
  if (now.getTime() <= expiresAt) {
    return { mode: "online", capabilities: new Set(claims.capabilities) };
  }
  if (now.getTime() <= offlineGraceUntil) {
    return { mode: "offline_grace", capabilities: new Set(claims.offlineCapabilities) };
  }
  return { mode: "expired", capabilities: new Set() };
}
