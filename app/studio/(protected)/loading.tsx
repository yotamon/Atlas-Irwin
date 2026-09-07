import { ProcessingState } from "@/components/studio/processing-state";

export default function StudioLoading() {
  return (
    <ProcessingState
      className="studio-v2-page ensemblis-workspace-loading"
      ariaLabel="Loading workspace"
      eyebrow="Workspace signal"
      title="Bringing the next view into focus"
      detail="Keeping the artist context, current music, and decisions connected while the workspace changes."
      compact
      steps={[
        { label: "Context", state: "complete" },
        { label: "View", state: "active" },
      ]}
    />
  );
}
