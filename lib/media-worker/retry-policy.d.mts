export type BackgroundFailureClass = "busy" | "gone" | "capacity" | "transient" | "terminal";

export const RETRY_NOT_BEFORE_KEY: "__ensemblis_retry_not_before";
export const LAST_ERROR_CLASS_KEY: "__ensemblis_last_error_class";

export function failureMessage(error: unknown): string;
export function classifyBackgroundFailure(error: unknown): BackgroundFailureClass;
export function retryDelayMs(errorClass: BackgroundFailureClass, attempt: number): number;
export function retryAt(errorClass: BackgroundFailureClass, attempt: number, nowMs?: number): string | null;
export function retryNotBefore(payload: unknown): number;
export function clearRetryMetadata(payload: Record<string, unknown>): Record<string, unknown>;
export function withRetryMetadata(
  payload: Record<string, unknown>,
  errorClass: BackgroundFailureClass,
  attempt: number,
  nowMs?: number,
): Record<string, unknown>;
