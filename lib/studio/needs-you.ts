import type { ReleaseMissionState } from "@/lib/studio/release-mission";

export type NeedsYouSeverity = "required" | "decision" | "review";

export type NeedsYouSourceKind =
  | "mission"
  | "approval"
  | "outreach"
  | "publication"
  | "catalog_match"
  | "creative"
  | "task"
  | "learning";

export type NeedsYouItem = {
  id: string;
  category: string;
  title: string;
  detail: string;
  href: string;
  severity: NeedsYouSeverity;
  priority: number;
  source: {
    kind: NeedsYouSourceKind;
    id: string | null;
  };
  missionId: string | null;
};

export type NeedsYouProjectionInput = {
  activeReleaseId?: string | null;
  activeMission?: ReleaseMissionState | null;
  workflowApprovalCount: number;
  outreachDraftCount: number;
  manualReady: Array<{ id: string; platform: string; contentItemId?: string | null }>;
  unmatchedCount: number;
  missingAssets: Array<{ id: string; title: string; platform: string; scheduledLabel?: string | null; releaseId?: string | null }>;
  dueTasks: Array<{ id: string; title: string; priority: string; dueLabel?: string | null }>;
  proposedLearningCount: number;
};

const SEVERITY_WEIGHT: Record<NeedsYouSeverity, number> = {
  required: 300,
  decision: 200,
  review: 100,
};

function item(input: Omit<NeedsYouItem, "priority"> & { priority?: number }): NeedsYouItem {
  return {
    ...input,
    priority: SEVERITY_WEIGHT[input.severity] + (input.priority ?? 0),
  };
}

function dedupe(items: NeedsYouItem[]) {
  const seen = new Set<string>();
  return items.filter((entry) => {
    const key = `${entry.source.kind}:${entry.source.id ?? entry.id}:${entry.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function deriveNeedsYouQueue(input: NeedsYouProjectionInput): NeedsYouItem[] {
  const missionId = input.activeReleaseId ?? null;
  const queue: NeedsYouItem[] = [];

  for (const blocker of input.activeMission?.blockers ?? []) {
    queue.push(item({
      id: `mission:${blocker.key}`,
      category: "Release Mission",
      title: blocker.title,
      detail: blocker.detail,
      href: blocker.href,
      severity: "required",
      priority: 90,
      source: { kind: "mission", id: blocker.key },
      missionId,
    }));
  }

  if (input.workflowApprovalCount) {
    queue.push(item({
      id: "workflow-approvals",
      category: "Approval",
      title: `${input.workflowApprovalCount} workflow approval${input.workflowApprovalCount === 1 ? "" : "s"} ready`,
      detail: "Review external effects Ensemblis has prepared. Nothing is executed just because it was prepared.",
      href: "/studio/inbox",
      severity: "decision",
      priority: 80,
      source: { kind: "approval", id: null },
      missionId,
    }));
  }

  if (input.outreachDraftCount) {
    queue.push(item({
      id: "outreach-drafts",
      category: "Outreach",
      title: `${input.outreachDraftCount} message${input.outreachDraftCount === 1 ? "" : "s"} prepared`,
      detail: "Approve delivery or use the prepared manual handoff.",
      href: "/studio/inbox",
      severity: "decision",
      priority: 70,
      source: { kind: "outreach", id: null },
      missionId,
    }));
  }

  for (const publication of input.manualReady.slice(0, 2)) {
    queue.push(item({
      id: `publication:${publication.id}`,
      category: "Ready for handoff",
      title: `${publication.platform} is prepared`,
      detail: "Everything is ready for the final manual publishing step.",
      href: publication.contentItemId ? `/studio/production?edit=${publication.contentItemId}` : "/studio/inbox",
      severity: "decision",
      priority: 60,
      source: { kind: "publication", id: publication.id },
      missionId,
    }));
  }

  if (input.unmatchedCount) {
    queue.push(item({
      id: "catalog-matches",
      category: "Needs matching",
      title: `${input.unmatchedCount} catalog match${input.unmatchedCount === 1 ? "" : "es"} need a decision`,
      detail: "Ensemblis found an ambiguous platform match and left the judgment to you.",
      href: "/studio/data-health?category=unmatched",
      severity: "decision",
      priority: 55,
      source: { kind: "catalog_match", id: null },
      missionId,
    }));
  }

  const missionMissingAssets = new Set(
    (input.activeMission?.recommendations ?? [])
      .filter((recommendation) => recommendation.key.startsWith("asset:"))
      .map((recommendation) => recommendation.title.replace(/^Finish\s+/i, "").toLowerCase()),
  );
  for (const asset of input.missingAssets.slice(0, 3)) {
    if (asset.releaseId === missionId && missionMissingAssets.has(asset.title.toLowerCase())) continue;
    queue.push(item({
      id: `creative:${asset.id}`,
      category: "Creative",
      title: `${asset.title} is waiting for its asset`,
      detail: `${asset.platform}${asset.scheduledLabel ? ` · ${asset.scheduledLabel}` : ""}`,
      href: `/studio/production?edit=${asset.id}`,
      severity: "review",
      priority: 40,
      source: { kind: "creative", id: asset.id },
      missionId: asset.releaseId ?? missionId,
    }));
  }

  for (const task of input.dueTasks.slice(0, 3)) {
    queue.push(item({
      id: `task:${task.id}`,
      category: "Task",
      title: task.title,
      detail: task.dueLabel ? `${task.priority} · ${task.dueLabel}` : task.priority,
      href: missionId ? `/studio/releases/${missionId}` : "/studio/releases",
      severity: "review",
      priority: 30,
      source: { kind: "task", id: task.id },
      missionId,
    }));
  }

  if (input.proposedLearningCount) {
    queue.push(item({
      id: "learning-proposals",
      category: "Learning",
      title: `${input.proposedLearningCount} evidence-backed insight${input.proposedLearningCount === 1 ? "" : "s"} to review`,
      detail: "Only approved findings may become active Artist Memory and influence future decisions.",
      href: "/studio/learn",
      severity: "review",
      priority: 20,
      source: { kind: "learning", id: null },
      missionId,
    }));
  }

  return dedupe(queue)
    .sort((left, right) => right.priority - left.priority || left.title.localeCompare(right.title))
    .slice(0, 10);
}

export function needsYouTone(item: NeedsYouItem): "important" | "warning" | "normal" {
  if (item.severity === "required") return "important";
  if (item.severity === "decision") return "warning";
  return "normal";
}
