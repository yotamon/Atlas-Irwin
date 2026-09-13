export const RECORDING_VERSION = "ensemblis.recording.v1" as const;
export const MEDIA_REFERENCE_VERSION = "ensemblis.media-reference.v1" as const;

export type RecordingFingerprint = `sha256:${string}`;
export type MediaAvailability = "available" | "offline" | "missing" | "unknown";

export type RecordingIdentity = {
  version: typeof RECORDING_VERSION;
  id: string;
  fingerprint: RecordingFingerprint;
  durationMs?: number | null;
  mimeType?: string | null;
};

export type LocalMediaReference = {
  version: typeof MEDIA_REFERENCE_VERSION;
  kind: "local_binding";
  recordingFingerprint: RecordingFingerprint;
  bindingId: string;
  deviceId?: string | null;
  availability: MediaAvailability;
};

export type CloudMediaReference = {
  version: typeof MEDIA_REFERENCE_VERSION;
  kind: "cloud_object";
  recordingFingerprint: RecordingFingerprint;
  provider: string;
  bucket?: string | null;
  objectKey: string;
  availability: MediaAvailability;
};

export type BrowserMediaReference = {
  version: typeof MEDIA_REFERENCE_VERSION;
  kind: "browser_handle";
  recordingFingerprint: RecordingFingerprint;
  handleId: string;
  availability: MediaAvailability;
};

export type MediaReference = LocalMediaReference | CloudMediaReference | BrowserMediaReference;

const FINGERPRINT_RE = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_LOCAL_KEYS = new Set([
  "path",
  "filepath",
  "file_path",
  "localpath",
  "local_path",
  "location",
  "fileuri",
  "file_uri",
  "rootpath",
  "root_path",
]);
const LOCAL_LOCATOR_RE = /^(?:file:\/\/|[a-z]:[\\/]|\\\\|\/(?:users|home|volumes|mnt|media)\/)/i;

export function isRecordingFingerprint(value: unknown): value is RecordingFingerprint {
  return typeof value === "string" && FINGERPRINT_RE.test(value);
}

export function assertRecordingFingerprint(value: unknown, field = "recordingFingerprint"): asserts value is RecordingFingerprint {
  if (!isRecordingFingerprint(value)) throw new Error(`${field} must be a content SHA-256 recording identity.`);
}

export function assertPathFreePortableValue(value: unknown, field = "value"): void {
  if (typeof value === "string") {
    if (LOCAL_LOCATOR_RE.test(value.trim())) throw new Error(`${field} contains a device-local locator.`);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPathFreePortableValue(item, `${field}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_LOCAL_KEYS.has(key.toLowerCase())) throw new Error(`${field}.${key} is device-local and cannot enter portable state.`);
    assertPathFreePortableValue(nested, `${field}.${key}`);
  }
}
