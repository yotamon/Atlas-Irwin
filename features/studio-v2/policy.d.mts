export type StudioContentStatus =
  | "Archived"
  | "Published"
  | "Scheduled"
  | "Ready"
  | "In Production"
  | "Draft";

export type ApprovalPolicy = "confirmation" | "approval" | "automatic";

export function deriveContentStatus(input: {
  current?: string | null;
  publishedAt?: string | Date | null;
  scheduledAt?: string | Date | null;
  assetUrl?: string | null;
  caption?: string | null;
  hook?: string | null;
}): StudioContentStatus;

export function approvalPolicy(input: {
  paid?: boolean;
  external?: boolean;
  destructive?: boolean;
  reversible?: boolean;
}): ApprovalPolicy;

export function canAutoFixHealthIssue(
  kind: string,
  context?: {
    singleCandidate?: boolean;
    uniqueExactMatch?: boolean;
    [key: string]: unknown;
  },
): boolean;
