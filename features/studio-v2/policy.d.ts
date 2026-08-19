export type ContentStatusEvidence = {
  current?: string | null;
  publishedAt?: string | null;
  scheduledAt?: string | null;
  assetUrl?: string | null;
  caption?: string | null;
  hook?: string | null;
};

export function deriveContentStatus(evidence: ContentStatusEvidence): string;

export type ApprovalPolicyInput = {
  paid?: boolean;
  external?: boolean;
  destructive?: boolean;
  reversible?: boolean;
};

export function approvalPolicy(input: ApprovalPolicyInput): "automatic" | "approval" | "confirmation";

export function canAutoFixHealthIssue(kind: string, context?: Record<string, unknown>): boolean;
