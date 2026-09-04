export const VIDEO_PROJECT_STATUSES = [
  "draft",
  "analyzing_audio",
  "concept_review",
  "treatment_review",
  "production_plan_review",
  "look_dev",
  "look_review",
  "test_generation",
  "test_review",
  "production",
  "shot_review",
  "ready_to_render",
  "rendering",
  "complete",
  "blocked",
  "failed",
  "archived",
] as const;

export type VideoProjectStatus = (typeof VIDEO_PROJECT_STATUSES)[number];

export const VIDEO_PROJECT_KINDS = ["full_music_video", "teaser"] as const;
export type VideoProjectKind = (typeof VIDEO_PROJECT_KINDS)[number];

export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export const VIDEO_RESOLUTIONS = ["720p", "1080p", "4k"] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export const VIDEO_STORY_MODES = ["narrative", "abstract", "hybrid"] as const;
export type VideoStoryMode = (typeof VIDEO_STORY_MODES)[number];

export const VIDEO_PEOPLE_MODES = [
  "director_choice",
  "prefer_people",
  "no_people",
] as const;
export type VideoPeopleMode = (typeof VIDEO_PEOPLE_MODES)[number];

export const VIDEO_PROJECT_STAGES = [
  { key: "brief", label: "Brief" },
  { key: "music", label: "Music map" },
  { key: "concept", label: "Concepts" },
  { key: "treatment", label: "Treatment" },
  { key: "storyboard", label: "Storyboard" },
  { key: "look", label: "Look development" },
  { key: "production", label: "Production" },
  { key: "review", label: "Review" },
  { key: "render", label: "Render" },
] as const;

export type VideoProjectStage = (typeof VIDEO_PROJECT_STAGES)[number]["key"];

export const VIDEO_PROJECT_STATUS_LABELS: Record<VideoProjectStatus, string> = {
  draft: "Draft",
  analyzing_audio: "Analyzing audio",
  concept_review: "Concept review",
  treatment_review: "Treatment review",
  production_plan_review: "Production plan review",
  look_dev: "Look development",
  look_review: "Look review",
  test_generation: "Test generation",
  test_review: "Test review",
  production: "Production",
  shot_review: "Shot review",
  ready_to_render: "Ready to render",
  rendering: "Rendering",
  complete: "Complete",
  blocked: "Blocked",
  failed: "Failed",
  archived: "Archived",
};

export const VIDEO_PROJECT_KIND_LABELS: Record<VideoProjectKind, string> = {
  full_music_video: "Full music video",
  teaser: "Teaser",
};

export const VIDEO_STORY_MODE_LABELS: Record<VideoStoryMode, string> = {
  narrative: "Narrative",
  abstract: "Abstract",
  hybrid: "Hybrid",
};

export const VIDEO_PEOPLE_MODE_LABELS: Record<VideoPeopleMode, string> = {
  director_choice: "Director choice",
  prefer_people: "Prefer people",
  no_people: "No people",
};

export type VideoCreativeBrief = {
  note: string;
  story_mode: VideoStoryMode;
  people_mode: VideoPeopleMode;
  target: VideoProjectKind;
  workflow_mode: "quick_video" | "director_pro";
  concept_id: string | null;
  concept_snapshot: {
    title: string;
    description: string;
    rationale: string;
  } | null;
};

export function parseVideoCreativeBrief(value: unknown): VideoCreativeBrief {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const snapshot = record.concept_snapshot && typeof record.concept_snapshot === "object" && !Array.isArray(record.concept_snapshot)
    ? record.concept_snapshot as Record<string, unknown>
    : null;
  return {
    note: typeof record.note === "string" ? record.note : "",
    story_mode: VIDEO_STORY_MODES.includes(record.story_mode as VideoStoryMode)
      ? record.story_mode as VideoStoryMode
      : "hybrid",
    people_mode: VIDEO_PEOPLE_MODES.includes(record.people_mode as VideoPeopleMode)
      ? record.people_mode as VideoPeopleMode
      : "director_choice",
    target: VIDEO_PROJECT_KINDS.includes(record.target as VideoProjectKind)
      ? record.target as VideoProjectKind
      : "full_music_video",
    workflow_mode: record.workflow_mode === "quick_video" ? "quick_video" : "director_pro",
    concept_id: typeof record.concept_id === "string" && record.concept_id.trim() ? record.concept_id : null,
    concept_snapshot: snapshot
      && typeof snapshot.title === "string"
      && typeof snapshot.description === "string"
      && typeof snapshot.rationale === "string"
      ? {
          title: snapshot.title,
          description: snapshot.description,
          rationale: snapshot.rationale,
        }
      : null,
  };
}

export function availableBudget(input: {
  hard_budget_credits: number;
  spent_credits: number;
  reserved_credits: number;
}) {
  return Math.max(
    0,
    Number(input.hard_budget_credits) - Number(input.spent_credits) - Number(input.reserved_credits),
  );
}
