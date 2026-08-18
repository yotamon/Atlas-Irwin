import { reviseSelectedVideoConcept } from "@/app/studio/video-concept-actions";
import { SubmitButton } from "@/components/studio/submit-button";
import type { VideoWorkspaceData } from "./workspace-types";

export function ConceptRefinementPanel({ data }: { data: VideoWorkspaceData }) {
  if (data.project.status !== "treatment_review" || !data.project.selected_concept_id) return null;
  const selected = data.concepts.find((concept) => concept.id === data.project.selected_concept_id);
  if (!selected) return null;

  return (
    <section className="workspace-section video-concept-refinement" id="concept-refinement">
      <div className="section-head">
        <div>
          <span className="section-label">Creative refinement</span>
          <h2>Keep the strong idea, change what is not right</h2>
        </div>
        <span>0 video credits</span>
      </div>
      <div className="video-concept-refinement-grid">
        <div>
          <strong>Selected direction: {selected.title}</strong>
          <p>
            You can continue straight to treatment, or ask the Director to reinterpret this direction before storyboard work starts.
            A revision creates three new concept options and clears the current concept approval so you can choose again cleanly.
          </p>
        </div>
        <form action={reviseSelectedVideoConcept}>
          <input type="hidden" name="project_id" value={data.project.id} />
          <label className="field">
            <span>Revision or mix request</span>
            <textarea
              name="instruction"
              required
              minLength={3}
              maxLength={1800}
              rows={4}
              placeholder="Keep the recurring object and tactile world, but make the story less literal. Mix the ending with the surreal mechanism from concept 2..."
            />
          </label>
          <SubmitButton pendingLabel="Directing three revised concepts..." disabled={!data.services.director.configured}>
            Create 3 revised directions
          </SubmitButton>
          {!data.services.director.configured ? (
            <small>Creative Director setup is required before concept revisions.</small>
          ) : (
            <small>This uses the Creative Director API only. It does not authorize or submit Higgsfield video generation.</small>
          )}
        </form>
      </div>
    </section>
  );
}
