import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/config";
import type {
  DjLibraryBridgeDatabase,
  DjLibraryDeviceRow,
  DjLibrarySourceKind,
} from "@/types/dj-library-bridge-database";

export const DEVICE_PAIR_VERSION = "ensemblis.dj-library-device-pair.v1";
export const DEVICE_SYNC_VERSION = "ensemblis.dj-library-device-sync.v1";
export const DEVICE_JOB_VERSION = "ensemblis.dj-library-device-job.v1";
export const DEVICE_CREDENTIAL_PREFIX = "enlb_";
export const SOURCE_KINDS = new Set<DjLibrarySourceKind>([
  "local_library",
  "rekordbox",
  "traktor",
]);

const PAIRING_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const FORBIDDEN_LOCAL_KEYS = new Set([
  "path",
  "filepath",
  "file_path",
  "location",
  "fileuri",
  "file_uri",
  "rootpath",
  "root_path",
]);
const LOCAL_LOCATOR_VALUE = /^(?:file:\/\/|[a-z]:[\\/]|\\\\|\/(?:users|home|volumes|mnt|media)\/)/i;

export class DeviceRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function createDjLibraryServiceClient(): SupabaseClient<DjLibraryBridgeDatabase> {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for Library Bridge device operations.");
  }
  return createClient<DjLibraryBridgeDatabase>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizePairingCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

export function pairingCodeHash(value: string) {
  return sha256Hex(normalizePairingCode(value));
}

export function generatePairingCode() {
  const bytes = randomBytes(16);
  let raw = "";
  for (let index = 0; index < 16; index += 1) {
    raw += PAIRING_ALPHABET[bytes[index] % PAIRING_ALPHABET.length];
  }
  return raw.match(/.{1,4}/g)?.join("-") ?? raw;
}

export function generateDeviceCredential() {
  return `${DEVICE_CREDENTIAL_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function deviceCredentialHash(credential: string) {
  return sha256Hex(credential);
}

export function deviceCredentialDisplayPrefix(credential: string) {
  return credential.slice(0, 12);
}

export function sanitizeCapabilities(value: unknown) {
  const source = record(value);
  const allowed = [
    "scanLocalLibrary",
    "resolveLocalMedia",
    "renderMixPlan",
    "deltaSync",
    "rekordboxXml",
    "traktorNml",
  ] as const;
  return Object.fromEntries(
    allowed.map((key) => [key, source[key] === true]),
  );
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function boundedString(
  value: unknown,
  max: number,
  field: string,
  options: { required?: boolean } = {},
) {
  const text = typeof value === "string" ? value.trim() : "";
  if (options.required && !text) {
    throw new DeviceRequestError(`${field} is required.`);
  }
  if (text.length > max) {
    throw new DeviceRequestError(`${field} is too long.`);
  }
  return text;
}

export function boundedNumber(
  value: unknown,
  min: number,
  max: number,
  field: string,
) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new DeviceRequestError(`${field} is invalid.`);
  }
  return value;
}

export function assertPathFree(value: unknown, field = "payload") {
  if (typeof value === "string") {
    if (LOCAL_LOCATOR_VALUE.test(value.trim())) {
      throw new DeviceRequestError(`${field} contains a forbidden local locator value.`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertPathFree(item, field);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_LOCAL_KEYS.has(key.toLowerCase())) {
      throw new DeviceRequestError(`${field} contains a forbidden local locator field.`);
    }
    assertPathFree(nested, field);
  }
}

export function requireBodyWithin(request: Request, maxBytes: number) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new DeviceRequestError("Library Bridge request is too large.", 413);
  }
}

function bearerCredential(request: Request) {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const credential = match?.[1]?.trim() ?? "";
  if (!credential.startsWith(DEVICE_CREDENTIAL_PREFIX) || credential.length < 40 || credential.length > 160) {
    throw new DeviceRequestError("Invalid Library Bridge device credential.", 401);
  }
  return credential;
}

export async function authenticateLibraryDevice(request: Request) {
  const credential = bearerCredential(request);
  const client = createDjLibraryServiceClient();
  const credentialHash = deviceCredentialHash(credential);
  const { data, error } = await client
    .from("dj_library_devices")
    .select("*")
    .eq("credential_hash", credentialHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !data) {
    throw new DeviceRequestError("Library Bridge device is not paired or has been revoked.", 401);
  }

  const device = data as DjLibraryDeviceRow;
  await client
    .from("dj_library_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", device.id)
    .is("revoked_at", null);

  return { client, device };
}

export function jsonByteLength(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
