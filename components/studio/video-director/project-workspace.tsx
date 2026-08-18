import { ProjectHeader } from "./project-header";
import { StageRail } from "./stage-rail";
import { BriefPanel } from "./brief-panel";
import { RecoveryPanel } from "./recovery-panel";
import {
  ConceptsPanel,
  GenerationPanel,
  LookDevelopmentPanel,
  MusicMapPanel,
  NextActionCard,
  ProductionPlanPanel,
  RenderPanel,
  ServiceReadinessPanel,
  ShotReviewPanel,
  StoryboardPanel,
} from "./production-panels";
import type { VideoWorkspaceData } from "./workspace-types";

export function VideoProjectWorkspace({ data }: { data: VideoWorkspaceData }) {
  const { project, release, track, contextSignals } = data;
  return (
    <div className="video-project-workspace">
      <ProjectHeader project={project} release={release} track={track} />
      <StageRail status={project.status} />
      <RecoveryPanel data={data} />
      <NextActionCard data={data} />

      <div className="video-production-layout">
        <main className="workspace-stack">
          <BriefPanel
            project={project}
            release={release}
            track={track}
            hasAudio={contextSignals.hasAudio}
            hasArtwork={contextSignals.hasArtwork}
            hasReleaseIdentity={contextSignals.hasReleaseIdentity}
          />
          <MusicMapPanel data={data} />
          <ConceptsPanel data={data} />
          <ProductionPlanPanel data={data} />
          <StoryboardPanel data={data} />
          <LookDevelopmentPanel data={data} />
          <GenerationPanel data={data} />
          <ShotReviewPanel data={data} />
          <RenderPanel data={data} />
        </main>

        <aside className="video-production-sidebar">
          <ServiceReadinessPanel data={data} />
          <section className="workspace-section video-production-summary">
            <div className="section-head"><div><span className="section-label">Production memory</span><h2>Durable state</h2></div></div>
            <dl>
              <div><dt>Concepts</dt><dd>{data.concepts.length}</dd></div>
              <div><dt>Scenes</dt><dd>{data.scenes.length}</dd></div>
              <div><dt>Shots</dt><dd>{data.shots.length}</dd></div>
              <div><dt>Generations</dt><dd>{data.generations.length}</dd></div>
              <div><dt>Approvals</dt><dd>{data.approvals.length}</dd></div>
              <div><dt>Renders</dt><dd>{data.renders.length}</dd></div>
            </dl>
            <p>Every provider request, approval and accepted asset remains auditable after refresh or deploy.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
