import "server-only";

import { dispatchMediaWorkerJob as dispatchVercelSandboxJob } from "@/lib/media-worker/sandbox";
import { mediaWorkerProcessorId, withMediaWorkerContractVersion } from "@/lib/media-worker/contract";
import { persistedMediaWorkerEntitlements } from "@/lib/media-worker/job-authorization";
import {
  childExecutionContext,
  EXECUTION_TRACE_QUERY,
  observeExecution,
} from "@/lib/observability/execution-context";
import { routeProcessor } from "@/lib/platform/compute-router";
import { processorDescriptor } from "@/lib/platform/processors";
import { DEFAULT_EXECUTION_POLICY, type ExecutionPolicy } from "@/lib/platform/runtime";
import { createRuntimeTask } from "@/lib/platform/tasks";

export const MEDIA_WORKER_TRACE_PAYLOAD_KEY = "__ensemblis_trace_id";

export type MediaWorkerDispatchInput = Parameters<typeof dispatchVercelSandboxJob>[0];
export type MediaWorkerDispatchResult = Awaited<ReturnType<typeof dispatchVercelSandboxJob>>;

export type MediaWorkerExecutionAuthorization = {
  entitlements: ReadonlySet<string>;
  policy?: ExecutionPolicy;
};

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

function authorizeCloudExecution(
  input: MediaWorkerDispatchInput,
  authorization: MediaWorkerExecutionAuthorization,
) {
  const processorId = mediaWorkerProcessorId(input.jobType);
  const descriptor = processorDescriptor(processorId);
  if (!descriptor) throw new Error(`No processor descriptor exists for ${processorId}.`);
  const policy = authorization.policy ?? DEFAULT_EXECUTION_POLICY;
  const task = createRuntimeTask({
    id: input.jobId,
    idempotencyKey: input.jobId,
    processorId: descriptor.id,
    processorVersion: descriptor.processorVersion,
    payload: input.payload,
    policy,
    requestedTarget: "cloud",
  });
  const decision = routeProcessor(descriptor, {
    policy: task.execution.policy,
    networkOnline: true,
    availableTargets: new Set(["cloud"]),
    media: { local: false, cloud: true, browser: false },
    entitlements: authorization.entitlements,
  });
  if (decision.kind !== "selected" || decision.target !== "cloud") {
    throw new Error(`ComputeRouter rejected Media Worker execution: ${decision.reason}`);
  }
  return { task, decision };
}

async function executionAuthorization(
  input: MediaWorkerDispatchInput,
  authorization?: MediaWorkerExecutionAuthorization,
): Promise<MediaWorkerExecutionAuthorization> {
  if (authorization) return authorization;
  return {
    entitlements: await persistedMediaWorkerEntitlements(input.jobType, input.jobId),
  };
}

export async function dispatchMediaWorkerJob(
  input: MediaWorkerDispatchInput,
  authorization?: MediaWorkerExecutionAuthorization,
) {
  const dispatcher = getMediaWorkerDispatcher();
  const routed = authorizeCloudExecution(input, await executionAuthorization(input, authorization));
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
      __ensemblis_runtime_task_id: routed.task.id,
      __ensemblis_execution_target: routed.decision.target,
      [MEDIA_WORKER_TRACE_PAYLOAD_KEY]: context.traceId,
    }),
  };
  return observeExecution("media_worker.dispatch", context, () => dispatcher.dispatch(tracedInput));
}
