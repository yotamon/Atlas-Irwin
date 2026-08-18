import {
  VIDEO_PROJECT_STATUSES,
  type VideoProjectStage,
  type VideoProjectStatus,
} from "./domain";

const LINEAR_TRANSITIONS: Partial<Record<VideoProjectStatus, VideoProjectStatus>> = {
  draft: "analyzing_audio",
  analyzing_audio: "concept_review",
  concept_review: "treatment_review",
  treatment_review: "production_plan_review",
  production_plan_review: "look_dev",
  look_dev: "look_review",
  look_review: "test_generation",
  test_generation: "test_review",
  test_review: "production",
  production: "shot_review",
  shot_review: "ready_to_render",
  ready_to_render: "rendering",
  rendering: "complete",
};

const ACTIVE_STATUSES = VIDEO_PROJECT_STATUSES.filter(
  (status) => !["complete", "blocked", "failed", "archived"].includes(status),
);

export const PROJECT_TRANSITIONS: Record<
  VideoProjectStatus,
  readonly VideoProjectStatus[]
> = Object.fromEntries(
  VIDEO_PROJECT_STATUSES.map((status) => {
    if (status === "archived") return [status, []];
    if (status === "complete") return [status, ["archived"]];
    if (status === "blocked" || status === "failed") return [status, ["archived"]];
    const next = LINEAR_TRANSITIONS[status];
    const exceptional: VideoProjectStatus[] = ACTIVE_STATUSES.includes(status)
      ? ["blocked", "failed", "archived"]
      : [];
    return [status, next ? [next, ...exceptional] : exceptional];
  }),
) as Record<VideoProjectStatus, readonly VideoProjectStatus[]>;

export function canTransitionProject(
  from: VideoProjectStatus,
  to: VideoProjectStatus,
) {
  return PROJECT_TRANSITIONS[from].includes(to);
}

export function assertProjectTransition(
  from: VideoProjectStatus,
  to: VideoProjectStatus,
) {
  if (!canTransitionProject(from, to)) {
    throw new Error(`Invalid video project transition: ${from} -> ${to}`);
  }
}

export function projectStageForStatus(status: VideoProjectStatus): VideoProjectStage {
  switch (status) {
    case "draft":
      return "brief";
    case "analyzing_audio":
      return "music";
    case "concept_review":
      return "concept";
    case "treatment_review":
      return "treatment";
    case "production_plan_review":
      return "storyboard";
    case "look_dev":
    case "look_review":
      return "look";
    case "test_generation":
    case "test_review":
    case "production":
      return "production";
    case "shot_review":
      return "review";
    case "ready_to_render":
    case "rendering":
    case "complete":
      return "render";
    case "blocked":
    case "failed":
    case "archived":
      return "brief";
  }
}
