import "server-only";

import { createHash, webcrypto } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDjLibraryServiceClient } from "@/lib/dj-library/device-server";
import {
  SIGNED_ENTITLEMENT_CLAIMS_VERSION,
  type SignedEntitlementClaims,
} from "@/lib/platform/entitlements";
import type { DjLibraryDeviceRow } from "@/types/dj-library-bridge-database";
import type { LicensingDatabase } from "@/types/licensing-database";

const STUDIO_MAJOR_VERSION = 1;
const ONLINE_TOKEN_MS = 24 * 60 * 60 * 1000;
const OFFLINE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const HEADER = { alg: "EdDSA", typ: "ENSEMBLIS-ENTITLEMENT" } as const;

function requiredConfig(name: "ENSEMBLIS_ENTITLEMENT_SIGNER_PKCS8_BASE64" | "ENSEMBLIS_ENTITLEMENT_PUBLIC_KEY_SPKI_BASE64") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for desktop entitlement signing.`);
  return value;
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

async function signingKey() {
  const bytes = Buffer.from(requiredConfig("ENSEMBLIS_ENTITLEMENT_SIGNER_PKCS8_BASE64"), "base64");
  return webcrypto.subtle.importKey("pkcs8", bytes, { name: "Ed25519" }, false, ["sign"]);
}

export function entitlementPublicKeyBundle() {
  const bytes = Buffer.from(requiredConfig("ENSEMBLIS_ENTITLEMENT_PUBLIC_KEY_SPKI_BASE64"), "base64");
  const keyId = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
  return { algorithm: "Ed25519" as const, keyId, publicKeySpkiBase64: bytes.toString("base64") };
}

export async function signEntitlementClaims(claims: SignedEntitlementClaims) {
  const { keyId } = entitlementPublicKeyBundle();
  const header = base64Url(JSON.stringify({ ...HEADER, kid: keyId }));
  const payload = base64Url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = await webcrypto.subtle.sign("Ed25519", await signingKey(), Buffer.from(signingInput, "utf8"));
  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

function licensingClient() {
  return createDjLibraryServiceClient() as unknown as SupabaseClient<LicensingDatabase>;
}

async function activeGrantedCapabilities(ownerId: string) {
  const db = licensingClient();
  const { data, error } = await db.from("ensemblis_capability_grants").select("*").eq("owner_id", ownerId);
  if (error) throw new Error(error.message);
  const now = Date.now();
  return (data ?? [])
    .filter((grant) => !grant.expires_at || Date.parse(grant.expires_at) >= now)
    .map((grant) => grant.capability);
}

async function activateStudioLicense(device: DjLibraryDeviceRow) {
  const db = licensingClient();
  const { data, error } = await db.rpc("activate_ensemblis_perpetual_license", {
    p_owner_id: device.owner_id,
    p_device_id: device.id,
    p_major_version: STUDIO_MAJOR_VERSION,
  });
  if (error) {
    if (error.message.includes("ensemblis_device_limit_reached")) {
      throw new Error("This Studio license has reached its device activation limit.");
    }
    throw new Error(error.message);
  }
  return data?.[0] ?? null;
}

export async function issueDeviceEntitlement(device: DjLibraryDeviceRow) {
  const [license, granted] = await Promise.all([activateStudioLicense(device), activeGrantedCapabilities(device.owner_id)]);
  const online = new Set<string>(granted);
  const offline = new Set<string>();
  if (license?.activated) {
    online.add("local.processing");
    online.add("local.advanced_models");
    offline.add("local.processing");
    offline.add("local.advanced_models");
  }

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ONLINE_TOKEN_MS);
  const offlineGraceUntil = new Date(license?.activated ? issuedAt.getTime() + OFFLINE_GRACE_MS : expiresAt.getTime());
  const claims: SignedEntitlementClaims = {
    version: SIGNED_ENTITLEMENT_CLAIMS_VERSION,
    subjectId: device.owner_id,
    deviceId: device.id,
    capabilities: [...online].sort(),
    offlineCapabilities: [...offline].sort(),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    offlineGraceUntil: offlineGraceUntil.toISOString(),
    license: {
      kind: license?.activated ? "studio_perpetual_v1" : "account",
      majorVersion: license?.activated ? STUDIO_MAJOR_VERSION : null,
    },
  };
  return { token: await signEntitlementClaims(claims), claims, publicKey: entitlementPublicKeyBundle() };
}
