export type MediaWorkerDispatchFailureKind = "busy" | "capacity" | "gone" | "fatal";

export const MEDIA_WORKER_CAPACITY_RETRY_MS = 60 * 60 * 1000;
const CAPACITY_MARKER = "[media-worker-capacity retry-after=";

function detail(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function mediaWorkerDispatchFailure(error: unknown): {
  kind: MediaWorkerDispatchFailureKind;
  detail: string;
} {
  const message = detail(error);
  if (/already processing|worker is busy/i.test(message)) {
    return { kind: "busy", detail: message };
  }
  if (/(?:status code\s*)?410\b|SANDBOX_STOPPED|SNAPSHOT_NOT_FOUND/i.test(message)) {
    return { kind: "gone", detail: message };
  }
  if (
    /\b(?:402|429)\b|quota|billing|payment required|rate limit|hobby[^\n]*(?:limit|quota)|resource[^\n]*(?:limit|exhausted|unavailable)/i
      .test(message)
  ) {
    return { kind: "capacity", detail: message };
  }
  return { kind: "fatal", detail: message };
}

export function isMediaWorkerBusyError(error: unknown) {
  return mediaWorkerDispatchFailure(error).kind === "busy";
}

export function isMediaWorkerCapacityError(error: unknown) {
  return mediaWorkerDispatchFailure(error).kind === "capacity";
}

export function mediaWorkerCapacityRetryAt(now = Date.now()) {
  return new Date(now + MEDIA_WORKER_CAPACITY_RETRY_MS).toISOString();
}

export function mediaWorkerCapacityErrorMessage(error: unknown, retryAfter = mediaWorkerCapacityRetryAt()) {
  const message = detail(error).replace(/\s+/g, " ").trim();
  return `${CAPACITY_MARKER}${retryAfter}] ${message.slice(0, 1200)}`;
}

export function mediaWorkerCapacityRetryAfter(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^\[media-worker-capacity retry-after=([^\]]+)]/);
  if (!match) return null;
  const parsed = Date.parse(match[1]);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function mediaWorkerCapacityBlocked(value: unknown, now = Date.now()) {
  const retryAfter = mediaWorkerCapacityRetryAfter(value);
  if (!retryAfter) return { blocked: false as const, retryAfter: null };
  return {
    blocked: Date.parse(retryAfter) > now,
    retryAfter,
  };
}
