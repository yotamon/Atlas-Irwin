import "server-only";

import { dispatchMediaWorkerJob as dispatchVercelSandboxJob } from "@/lib/media-worker/sandbox";
import { withMediaWorkerContractVersion } from "@/lib/media-worker/contract";
import {
  childExecutionContext,
  EXECUTION_TRACE_QUERY,
  observeExecution,
} from "@/lib/observability/execution-context";

export const MEDIA_WORKER_TRACE_PAYLOAD_KEY = "__ensemblis_trace_id";

export type MediaWorkerDispatchInput = Parameters<typeof dispatchVercelSandboxJob>[0];
export type MediaWorkerDispatchResult = Awaited<ReturnType<typeof dispatchVercelSandboxJob>>;

export interface MediaWorkerDispatcher {
  readonly name: string;
  dispatch(input: MediaWorkerDispatchInput): Promise<MediaWorkerDispatchResult>;
}

const vercelSandboxDispatcher: MediaWorkerDispatcher = {
  name: "vercel_sandbox",
  dispatch: dispatchVercelSandboxJob,
};

const dispatchers = new Map<string, MediaWorkerDispatcher>([
  [vercelSandboxDispatcher.name, vercelSandboxDispatcher],
]);

function configuredDispatcherName() {
  return process.env.ENSEMBLIS_MEDIA_WORKER_PROVIDER?.trim() || "vercel_sandbox";
}

function callbackUrlWithTrace(callbackUrl: string, traceId: string) {
  const url = new URL(callbackUrl);
  url.searchParams.set(EXECUTION_TRACE_QUERY, traceId);
  return url.toString();
}

export function getMediaWorkerDispatcher() {
  const name = configuredDispatcherName();
  const dispatcher = dispatchers.get(name);
  if (!dispatcher) {
    throw new Error(
      `Unsupported Ensemblis Media Worker provider: ${name}. Configure ENSEMBLIS_MEDIA_WORKER_PROVIDER=vercel_sandbox.`,
    );
  }
  return dispatcher;
}

export async function dispatchMediaWorkerJob(input: MediaWorkerDispatchInput) {
  const dispatcher = getMediaWorkerDispatcher();
  const context = childExecutionContext({
    jobId: input.jobId,
    provider: dispatcher.name,
    operation: `media_worker.${input.jobType}`,
  });
  const tracedInput: MediaWorkerDispatchInput = {
    ...input,
    callbackUrl: callbackUrlWithTrace(input.callbackUrl, context.traceId),
    payload: withMediaWorkerContractVersion({
      ...input.payload,
      [MEDIA_WORKER_TRACE_PAYLOAD_KEY]: context.traceId,
    }),
  };
  return observeExecution("media_worker.dispatch", context, () => dispatcher.dispatch(tracedInput));
}
