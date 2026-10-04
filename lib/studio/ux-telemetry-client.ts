export type StudioUxEventName =
  | "surface_view"
  | "launcher_opened"
  | "launcher_resolution"
  | "launcher_action"
  | "primary_action"
  | "advanced_opened"
  | "recommendation_bypass"
  | "navigation_recovery"
  | "workflow_stage"
  | "advanced_detail_dependency";

export type StudioUxEventDetail = {
  event: StudioUxEventName;
  source?: string;
  intentKind?: string | null;
  resultType?: string | null;
  resolutionSource?: string | null;
  durationMs?: number | null;
  frictionKind?: "alternate_action" | "before_primary_action" | "launcher_recovery" | null;
  workflowStage?: string | null;
};

export const STUDIO_UX_EVENT = "ensemblis:ux-event";

export function emitStudioUxEvent(detail: StudioUxEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StudioUxEventDetail>(STUDIO_UX_EVENT, { detail }));
}
