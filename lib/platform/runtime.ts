import type { MediaReference } from "./recordings";

export const RUNTIME_TASK_VERSION = "ensemblis.runtime-task.v1" as const;
export const PROCESSOR_DESCRIPTOR_VERSION = "ensemblis.processor-descriptor.v1" as const;
export const EXECUTION_POLICY_VERSION = "ensemblis.execution-policy.v1" as const;

export type ExecutionTarget = "local_sidecar" | "cloud" | "browser";
export type ExecutionPreference = "automatic" | "prefer_local" | "prefer_cloud";
export type MediaTransfer = "none" | "upload" | "download";

export type ExecutionPolicy = {
  version: typeof EXECUTION_POLICY_VERSION;
  preference: ExecutionPreference;
  neverUploadAudio: boolean;
  allowPaidCompute: boolean;
  cloudFallback: boolean;
};

export type ProcessorTargetRequirement = {
  supported: boolean;
  requiresNetwork?: boolean;
  paidCompute?: boolean;
  requiredEntitlement?: string | null;
};

export type ProcessorDescriptor = {
  version: typeof PROCESSOR_DESCRIPTOR_VERSION;
  id: string;
  processorVersion: string;
  inputKinds: readonly string[];
  outputKinds: readonly string[];
  targets: Partial<Record<ExecutionTarget, ProcessorTargetRequirement>>;
  privacy: {
    requiresRawAudio: boolean;
    resultMayContainSensitiveMetadata?: boolean;
  };
};

export type RuntimeTask = {
  version: typeof RUNTIME_TASK_VERSION;
  id: string;
  idempotencyKey: string;
  processor: { id: string; version: string };
  inputReferences: Array<{
    kind: "recording" | "analysis" | "project" | "asset";
    id: string;
    recordingFingerprint?: string | null;
  }>;
  payload: Record<string, unknown>;
  execution: {
    policy: ExecutionPolicy;
    requestedTarget?: "automatic" | ExecutionTarget;
  };
  context?: Record<string, unknown>;
};

export type RuntimeMediaAvailability = {
  local: boolean;
  cloud: boolean;
  browser: boolean;
};

export function availabilityFromMediaReferences(references: readonly MediaReference[]): RuntimeMediaAvailability {
  return references.reduce<RuntimeMediaAvailability>((availability, reference) => {
    if (reference.availability !== "available") return availability;
    if (reference.kind === "local_binding") availability.local = true;
    if (reference.kind === "cloud_object") availability.cloud = true;
    if (reference.kind === "browser_handle") availability.browser = true;
    return availability;
  }, { local: false, cloud: false, browser: false });
}

export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = {
  version: EXECUTION_POLICY_VERSION,
  preference: "automatic",
  neverUploadAudio: false,
  allowPaidCompute: true,
  cloudFallback: true,
};
