import { ProcessingState } from "@/components/studio/processing-state";

export default function Loading() {
  return (
    <div className="ensemblis-loading">
      <ProcessingState
        eyebrow="Studio"
        title="Opening your artist workspace"
        detail="Loading the current workspace and the data required for this view."
        steps={[{ label: "Workspace data", state: "active" }]}
      />
    </div>
  );
}
