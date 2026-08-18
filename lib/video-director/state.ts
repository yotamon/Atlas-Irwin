import type { VideoProjectStage, VideoProjectStatus } from "./domain";

export const PROJECT_TRANSITIONS: Record<
  VideoProjectStatus,
  readonly VideoProjectStatus[]
> = {
  draft: ["analyzing_audio", "blocked", "failed", "archived"],
  analyzing_audio: ["concept_review", "blocked", "failed", "archived"],
  concept_review: ["treatment_review", "blocked", "failed", "archived"],
  treatment_review: ["production_plan_review", "blocked", "failed", "archived"],
  production_plan_review: ["look_dev", "blocked", "failed", "archived"],
  look_dev: ["look_review", "blocked", "failed", "archived"],
  look_review: ["test_generation", "blocked", "failed", "archived"],
  test_generation: ["test_review", "blocked", "failed", "archived"],
  test_review: ["production", "blocked", "failed", "archived"],
  production: ["shot_review", "blocked", "failed", "archived"],
  shot_review: ["ready_to_render", "blocked", "failed", "archived"],
  ready_to_render: ["rendering", "blocked", "failed", "archived"],
  rendering: ["complete", "blocked", "failed", "archived"],
  complete: ["archived"],
  blocked: ["archived"],
  failed: ["archived"],
  archived: [],
};

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
