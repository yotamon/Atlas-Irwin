import Link from "next/link";
import { parseVideoCreativeBrief } from "@/lib/video-director/domain";
import { ProjectHeader } from "./project-header";
import { StageRail } from "./stage-rail";
import { BriefPanel } from "./brief-panel";
import { RecoveryPanel } from "./recovery-panel";
import { DeliveryPanel } from "./delivery-panel";
import { LookDevelopmentPanel } from "./look-development-panel";
import { ConceptRefinementPanel } from "./concept-refinement-panel";
import { TrackIntelligenceInspector } from "./track-intelligence-inspector";
import { QuickVideoProjectWorkspace } from "./quick-video-project-workspace";
import { VideoDirectorProEditor } from "./editor/video-director-pro-editor";
import {
  ConceptsPanel,
  GenerationPanel,
  NextActionCard,
  ProductionPlanPanel,
  ServiceReadinessPanel,
  ShotReviewPanel,
  StoryboardPanel,
} from "./production-panels";
import type { VideoWorkspaceData } from "./workspace-types";

export function VideoProjectWorkspace({
  data,
  mode = "default",
}: {
  data: VideoWorkspaceData;
  mode?: "default" | "pro";
}) {
  const brief = parseVideoCreativeBrief(data.project.creative_brief);
  if (brief.workflow_mode === "quick_video" && mode !== "pro") {
    return <QuickVideoProjectWorkspace data={data} />;
  }

  const { project, release, track, contextSignals } = data;
  return (
    <div className="video-project-workspace">
      <ProjectHeader project={project} release={release} track={track} />
      {brief.workflow_mode === "quick_video" ? (
        <section className="workspace-section">
          <div className="section-head">
            <div><span className="section-label">Director Pro</span><h2>Full creative edit</h2></div>
            <Link className="button" href={`/studio/video/${project.id}`}>Back to Quick Video</Link>
          </div>
          <p className="section-copy">This is the same durable Quick Video production opened as a music-aware editor. Every change stays attached to the same shots, approvals, generation history and final delivery.</p>
        </section>
      ) : null}
      <StageRail status={project.status} />
      <RecoveryPanel data={data} />
      <NextActionCard data={data} />

      <VideoDirectorProEditor data={data} />

      <details className="video-pro-production-details">
        <summary>Advanced production controls</summary>
        <div className="video-production-layout">
          <main className="workspace-stack">
            <BriefPanel
              project={project}
              release={release}
              track={track}
              hasAudio={contextSignals.hasAudio}
              hasArtwork={contextSignals.hasArtwork}
              hasReleaseIdentity={contextSignals.hasReleaseIdentity}
              productionProfilePreviews={data.productionProfilePreviews}
            />
            <TrackIntelligenceInspector data={data} />
            <ConceptsPanel data={data} />
            <ConceptRefinementPanel data={data} />
            <ProductionPlanPanel data={data} />
            <StoryboardPanel data={data} />
            <LookDevelopmentPanel data={data} />
            <GenerationPanel data={data} />
            <ShotReviewPanel data={data} />
            <DeliveryPanel data={data} />
          </main>

          <aside className="video-production-sidebar">
            <ServiceReadinessPanel data={data} />
            <section className="workspace-section video-production-summary">
              <div className="section-head"><div><span className="section-label">Production memory</span><h2>Durable state</h2></div></div>
              <dl>
                <div><dt>Concepts</dt><dd>{data.concepts.length}</dd></div>
                <div><dt>Scenes</dt><dd>{data.scenes.length}</dd></div>
                <div><dt>Shots</dt><dd>{data.shots.length}</dd></div>
                <div><dt>Cast</dt><dd>{data.characters.length}</dd></div>
                <div><dt>Generations</dt><dd>{data.generations.length}</dd></div>
                <div><dt>Approvals</dt><dd>{data.approvals.length}</dd></div>
                <div><dt>Renders</dt><dd>{data.renders.length}</dd></div>
              </dl>
              <p>Every provider request, approval, render, selected source and editor decision remains auditable after refresh or deploy.</p>
            </section>
          </aside>
        </div>
      </details>
    </div>
  );
}
