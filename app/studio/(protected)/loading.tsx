import { ProcessingState } from "@/components/studio/processing-state";

export default function StudioLoading() {
  return (
    <div
      className="studio-v2-page ensemblis-workspace-loading"
      role="status"
      aria-live="polite"
      aria-label="Loading workspace"
    >
      <ProcessingState
        announce={false}
        eyebrow="Workspace signal"
        title="Bringing the next view into focus"
        detail="Keeping the artist context, current music, and decisions connected while the workspace changes."
        compact
        steps={[
          { label: "Context", state: "complete" },
          { label: "View", state: "active" },
        ]}
      />
    </div>
  );
}
