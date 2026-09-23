import type {
  ExecutionPolicy,
  ExecutionTarget,
  MediaTransfer,
  ProcessorDescriptor,
  RuntimeMediaAvailability,
} from "./runtime";

export type ComputeRouterContext = {
  policy: ExecutionPolicy;
  networkOnline: boolean;
  availableTargets: ReadonlySet<ExecutionTarget>;
  media: RuntimeMediaAvailability;
  entitlements: ReadonlySet<string>;
};

export type ComputeCandidate = {
  target: ExecutionTarget;
  eligible: boolean;
  transfer: MediaTransfer;
  reasons: string[];
};

export type ComputeDecision =
  | { kind: "selected"; target: ExecutionTarget; transfer: MediaTransfer; reason: string; candidates: ComputeCandidate[] }
  | { kind: "unavailable"; reason: string; candidates: ComputeCandidate[] };

function mediaTransfer(target: ExecutionTarget, descriptor: ProcessorDescriptor, media: RuntimeMediaAvailability): MediaTransfer | null {
  if (!descriptor.privacy.requiresRawAudio) return "none";
  if (target === "local_sidecar") {
    if (media.local) return "none";
    if (media.cloud) return "download";
    return null;
  }
  if (target === "cloud") {
    if (media.cloud) return "none";
    if (media.local || media.browser) return "upload";
    return null;
  }
  if (media.browser) return "none";
  if (media.cloud) return "download";
  return null;
}

function evaluateTarget(
  target: ExecutionTarget,
  descriptor: ProcessorDescriptor,
  context: ComputeRouterContext,
): ComputeCandidate {
  const requirement = descriptor.targets[target];
  const reasons: string[] = [];
  if (!requirement?.supported) reasons.push("processor does not support this target");
  if (!context.availableTargets.has(target)) reasons.push("runtime target is unavailable");
  if (requirement?.requiresNetwork && !context.networkOnline) reasons.push("network is unavailable");
  if (requirement?.requiredEntitlement && !context.entitlements.has(requirement.requiredEntitlement)) {
    reasons.push(`missing entitlement: ${requirement.requiredEntitlement}`);
  }
  if (requirement?.paidCompute && !context.policy.allowPaidCompute) reasons.push("paid compute is disabled by policy");

  const transfer = mediaTransfer(target, descriptor, context.media);
  if (transfer === null) reasons.push("required raw media is unavailable to this target");
  if (transfer === "upload" && context.policy.neverUploadAudio) reasons.push("audio upload is forbidden by policy");
  if (target === "cloud" && context.policy.preference === "prefer_local" && !context.policy.cloudFallback) {
    reasons.push("cloud fallback is disabled by policy");
  }

  return { target, eligible: reasons.length === 0, transfer: transfer ?? "none", reasons };
}

function preferenceOrder(policy: ExecutionPolicy, descriptor: ProcessorDescriptor, media: RuntimeMediaAvailability): ExecutionTarget[] {
  if (policy.preference === "prefer_cloud") return ["cloud", "local_sidecar", "browser"];
  if (policy.preference === "prefer_local") return ["local_sidecar", "browser", "cloud"];

  // Automatic minimizes raw media movement before considering remote compute.
  if (descriptor.privacy.requiresRawAudio) {
    const colocated: ExecutionTarget[] = [];
    if (media.local) colocated.push("local_sidecar");
    if (media.browser) colocated.push("browser");
    if (media.cloud) colocated.push("cloud");
    return [...new Set<ExecutionTarget>([...colocated, "local_sidecar", "browser", "cloud"])];
  }
  return ["local_sidecar", "browser", "cloud"];
}

export function routeProcessor(descriptor: ProcessorDescriptor, context: ComputeRouterContext): ComputeDecision {
  const candidates = (["local_sidecar", "cloud", "browser"] as const).map((target) => evaluateTarget(target, descriptor, context));
  const candidateByTarget = new Map(candidates.map((candidate) => [candidate.target, candidate]));
  for (const target of preferenceOrder(context.policy, descriptor, context.media)) {
    const candidate = candidateByTarget.get(target);
    if (!candidate?.eligible) continue;
    const transferNote = candidate.transfer === "none" ? "without raw media transfer" : `with ${candidate.transfer}`;
    return { kind: "selected", target, transfer: candidate.transfer, reason: `${target} selected ${transferNote}`, candidates };
  }
  const blockers = candidates.flatMap((candidate) => candidate.reasons.map((reason) => `${candidate.target}: ${reason}`));
  return { kind: "unavailable", reason: blockers.length ? blockers.join("; ") : "no compatible execution target", candidates };
}
