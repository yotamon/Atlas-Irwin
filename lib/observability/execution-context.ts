import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export const EXECUTION_TRACE_HEADER = "x-ensemblis-trace-id";
export const EXECUTION_TRACE_QUERY = "ensemblis_trace_id";

export type ExecutionContext = {
  traceId: string;
  workspaceId?: string;
  artistId?: string;
  trackId?: string;
  releaseId?: string;
  jobId?: string;
  provider?: string;
  model?: string;
  operation?: string;
  estimatedCostUsd?: number;
};

type LogLevel = "debug" | "info" | "warn" | "error";
type LogAttributes = Record<string, unknown>;

const executionStorage = new AsyncLocalStorage<ExecutionContext>();
const SAFE_TRACE_ID = /^[a-zA-Z0-9._:-]{8,128}$/;

function normalizeOptionalId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function validatedTraceId(value: string | null | undefined) {
  const candidate = value?.trim();
  return candidate && SAFE_TRACE_ID.test(candidate) ? candidate : undefined;
}

export function traceIdFromRequest(request: Request) {
  const headerTrace = validatedTraceId(request.headers.get(EXECUTION_TRACE_HEADER));
  if (headerTrace) return headerTrace;

  try {
    const queryTrace = validatedTraceId(
      new URL(request.url).searchParams.get(EXECUTION_TRACE_QUERY),
    );
    if (queryTrace) return queryTrace;
  } catch {
    // Request URLs should always be absolute here; generate a trace if a custom runtime violates that contract.
  }

  return randomUUID();
}

export function createExecutionContext(
  values: Omit<Partial<ExecutionContext>, "traceId"> & { traceId?: string } = {},
): ExecutionContext {
  return {
    traceId: validatedTraceId(values.traceId) ?? randomUUID(),
    workspaceId: normalizeOptionalId(values.workspaceId),
    artistId: normalizeOptionalId(values.artistId),
    trackId: normalizeOptionalId(values.trackId),
    releaseId: normalizeOptionalId(values.releaseId),
    jobId: normalizeOptionalId(values.jobId),
    provider: normalizeOptionalId(values.provider),
    model: normalizeOptionalId(values.model),
    operation: normalizeOptionalId(values.operation),
    estimatedCostUsd: values.estimatedCostUsd,
  };
}

export function currentExecutionContext() {
  return executionStorage.getStore();
}

export function childExecutionContext(
  values: Omit<Partial<ExecutionContext>, "traceId"> & { traceId?: string },
) {
  const parent = currentExecutionContext();
  return createExecutionContext({
    ...parent,
    ...values,
    traceId: values.traceId ?? parent?.traceId,
  });
}

export function runWithExecutionContext<T>(
  context: ExecutionContext,
  operation: () => T,
) {
  return executionStorage.run(context, operation);
}

function errorAttributes(error: unknown) {
  if (error instanceof Error) {
    return {
      error_name: error.name,
      error_message: error.message,
    };
  }
  return { error_message: String(error) };
}

export function logExecutionEvent(
  level: LogLevel,
  event: string,
  attributes: LogAttributes = {},
  context = currentExecutionContext(),
) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(context ?? {}),
    ...attributes,
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.info(line);
}

export async function observeExecution<T>(
  event: string,
  context: ExecutionContext,
  operation: () => Promise<T>,
) {
  const startedAt = performance.now();
  return runWithExecutionContext(context, async () => {
    logExecutionEvent("info", `${event}.started`);
    try {
      const result = await operation();
      logExecutionEvent("info", `${event}.completed`, {
        duration_ms: Math.round(performance.now() - startedAt),
      });
      return result;
    } catch (error) {
      logExecutionEvent("error", `${event}.failed`, {
        duration_ms: Math.round(performance.now() - startedAt),
        ...errorAttributes(error),
      });
      throw error;
    }
  });
}
