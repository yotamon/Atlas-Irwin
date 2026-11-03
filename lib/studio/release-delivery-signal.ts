/**
 * Read-only, evidence-backed distribution progress for a release.
 *
 * Public site publication and a "Live" catalog status are not proof that a DSP
 * accepted delivery. Only canonical provider state confirms a provider outcome.
 * This projection never creates, submits or approves an external release.
 */
export type DeliverySignalKind =
  | "confirmed_live"
  | "in_flight"
  | "ready_for_approval"
  | "needs_setup"
  | "needs_preflight"
  | "needs_review"
  | "external_untracked"
  | "unavailable";

export type DeliverySignal = {
  kind: DeliverySignalKind;
  label: string;
  detail: string;
  requiresAttention: boolean;
  providerConfirmed: boolean;
};

export type DeliverySignalInput = {
  releaseIsLive: boolean;
  providerState: string | null;
  accountStatus: string | null;
  evidenceUnavailable?: boolean;
};

const IN_FLIGHT_STATES = new Set([
  "submitted", "under_review", "approved", "delivering", "delivered",
  "partially_live", "update_pending", "takedown_pending",
]);

const PROBLEM_STATES = new Set(["rejected", "error", "needs_attention"]);

export function deriveDeliverySignal(input: DeliverySignalInput): DeliverySignal {
  if (input.evidenceUnavailable) {
    return {
      kind: "unavailable",
      label: "Delivery could not be verified",
      detail: "Ensemblis could not read the current distribution state. Check delivery before relying on a launch date.",
      requiresAttention: true,
      providerConfirmed: false,
    };
  }

  if (input.providerState === "live") {
    return {
      kind: "confirmed_live",
      label: "Live at the distributor",
      detail: "The connected distributor reports this release as live. Verify each store destination before promotion.",
      requiresAttention: false,
      providerConfirmed: true,
    };
  }

  if (input.providerState && IN_FLIGHT_STATES.has(input.providerState)) {
    return {
      kind: "in_flight",
      label: input.providerState === "partially_live" ? "Partially live" : "Submitted to distributor",
      detail: "Delivery has been recorded in Ensemblis. Track store-specific status before telling listeners the release is available.",
      requiresAttention: input.providerState === "partially_live",
      providerConfirmed: true,
    };
  }

  // Historical releases may have been delivered externally before Ensemblis
  // gained distribution integrations. Preserve them without fabricating a submission.
  if (input.releaseIsLive && !input.providerState) {
    return {
      kind: "external_untracked",
      label: "External delivery not tracked",
      detail: "The catalog marks this release live, but Ensemblis has no provider submission evidence. Keep existing public links; verify delivery with your distributor.",
      requiresAttention: false,
      providerConfirmed: false,
    };
  }

  if (input.accountStatus !== "active") {
    return {
      kind: "needs_setup",
      label: "Distribution connection needs attention",
      detail: input.accountStatus === "pending_verification"
        ? "Your distributor is pending verification. Confirm the account is eligible before submitting."
        : "No active distribution account is connected. You can also submit through your existing distributor and manage public listening links separately.",
      requiresAttention: true,
      providerConfirmed: false,
    };
  }

  if (!input.providerState || input.providerState === "draft") {
    return {
      kind: "needs_preflight",
      label: "Prepare distribution",
      detail: "A connected distributor alone does not prepare the release. Confirm masters, credits, rights, stores and the delivery package.",
      requiresAttention: true,
      providerConfirmed: false,
    };
  }

  if (PROBLEM_STATES.has(input.providerState)) {
    return {
      kind: "needs_review",
      label: "Distribution needs review",
      detail: "Provider preparation reported a problem. Open delivery details to resolve the exact issue before submitting.",
      requiresAttention: true,
      providerConfirmed: false,
    };
  }

  if (input.providerState === "ready") {
    return {
      kind: "ready_for_approval",
      label: "Ready for distribution approval",
      detail: "The delivery package is prepared, but it has not been submitted. Artist approval is still required.",
      requiresAttention: true,
      providerConfirmed: false,
    };
  }

  return {
    kind: "unavailable",
    label: "Delivery state needs verification",
    detail: "The distributor returned an unfamiliar state. Verify it in the delivery workspace instead of assuming a successful launch.",
    requiresAttention: true,
    providerConfirmed: false,
  };
}
