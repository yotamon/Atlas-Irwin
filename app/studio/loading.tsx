import { ProcessingState } from "@/components/studio/processing-state";

export default function Loading() {
  return (
    <div className="ensemblis-loading">
      <ProcessingState
        eyebrow="Studio signal"
        title="Tuning your artist workspace"
        detail="Loading music, context, and the latest decisions into one coherent view."
        steps={[
          { label: "Artist context", state: "complete" },
          { label: "Music intelligence", state: "active" },
          { label: "Workspace", state: "waiting" },
        ]}
      />
    </div>
  );
}
