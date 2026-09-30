export const RETRY_NOT_BEFORE_KEY = "__ensemblis_retry_not_before";
export const LAST_ERROR_CLASS_KEY = "__ensemblis_last_error_class";

export function failureMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function classifyBackgroundFailure(error) {
  const detail = failureMessage(error);
  if (/already processing|worker is busy|lock contention/i.test(detail)) return "busy";
  if (/(?:status code\s*)?410\b|SANDBOX_STOPPED|SNAPSHOT_NOT_FOUND/i.test(detail)) return "gone";
  if (/quota|limit|billing|payment|required|resource|402|429|hobby|rate.?limit/i.test(detail)) {
    return "capacity";
  }
  if (/unauthorized|forbidden|invalid (?:request|payload)|missing (?:required|artist|owner|content)|lineage/i.test(detail)) {
    return "terminal";
  }
  return "transient";
}

export function retryDelayMs(errorClass, attempt) {
  const boundedAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
  if (errorClass === "capacity") {
    return Math.min(24, 2 ** Math.min(5, boundedAttempt - 1)) * 60 * 60 * 1000;
  }
  if (errorClass === "busy") return Math.min(5 * 60_000, boundedAttempt * 30_000);
  if (errorClass === "gone") return Math.min(15 * 60_000, boundedAttempt * 60_000);
  if (errorClass === "terminal") return 0;
  return Math.min(60 * 60_000, 2 ** Math.min(5, boundedAttempt - 1) * 60_000);
}

export function retryAt(errorClass, attempt, nowMs = Date.now()) {
  const delay = retryDelayMs(errorClass, attempt);
  return delay > 0 ? new Date(nowMs + delay).toISOString() : null;
}

export function retryNotBefore(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
  const value = payload[RETRY_NOT_BEFORE_KEY];
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clearRetryMetadata(payload) {
  const clean = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload } : {};
  delete clean[RETRY_NOT_BEFORE_KEY];
  delete clean[LAST_ERROR_CLASS_KEY];
  return clean;
}

export function withRetryMetadata(payload, errorClass, attempt, nowMs = Date.now()) {
  const clean = clearRetryMetadata(payload);
  const retryAtValue = retryAt(errorClass, attempt, nowMs);
  return {
    ...clean,
    ...(retryAtValue ? { [RETRY_NOT_BEFORE_KEY]: retryAtValue } : {}),
    [LAST_ERROR_CLASS_KEY]: errorClass,
  };
}
