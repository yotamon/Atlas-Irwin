import type { MusicVideoProject, Release, Track } from "@/types/database";
import { ProjectHeader } from "./project-header";
import { StageRail } from "./stage-rail";
import { BriefPanel } from "./brief-panel";

const FUTURE_STAGES = [
  ["Music map", "Audio structure, BPM, energy, sections, and edit points will appear here after Slice 2."],
  ["Concepts", "Three materially different creative directions will be reviewed here before any paid video generation."],
  ["Treatment and storyboard", "The approved concept will become a visual bible, scene plan, and timed shot list."],
  ["Look development", "Low-cost still references will establish the world before expensive video generation."],
  ["Production", "Approved generation batches, shot continuity, and provider jobs will live here."],
  ["Review and render", "Locked shots, final timeline assembly, and delivery formats will close the production."],
] as const;

export function VideoProjectWorkspace({
  project,
  release,
  track,
  hasAudio,
  hasArtwork,
  hasReleaseIdentity,
  conceptCount,
  sceneCount,
  shotCount,
}: {
  project: MusicVideoProject;
  release: Release;
  track: Track;
  hasAudio: boolean;
  hasArtwork: boolean;
  hasReleaseIdentity: boolean;
  conceptCount: number;
  sceneCount: number;
  shotCount: number;
}) {
  return (
    <div className="video-project-workspace">
      <ProjectHeader project={project} release={release} track={track} />
      <StageRail status={project.status} />

      <div className="video-workspace-grid">
        <main className="workspace-stack">
          <BriefPanel
            project={project}
            release={release}
            track={track}
            hasAudio={hasAudio}
            hasArtwork={hasArtwork}
            hasReleaseIdentity={hasReleaseIdentity}
          />

          <section className="workspace-section video-foundation-summary">
            <div className="section-head">
              <div>
                <span className="section-label">Foundation</span>
                <h2>Production data</h2>
              </div>
              <span>Persisted</span>
            </div>
            <div className="video-foundation-stats">
              <span><strong>{conceptCount}</strong><small>Concepts</small></span>
              <span><strong>{sceneCount}</strong><small>Scenes</small></span>
              <span><strong>{shotCount}</strong><small>Shots</small></span>
            </div>
          </section>
        </main>

        <aside className="video-future-panel">
          <div className="section-head">
            <div>
              <span className="section-label">Production pipeline</span>
              <h2>Coming next</h2>
            </div>
          </div>
          <div className="video-future-list">
            {FUTURE_STAGES.map(([title, body], index) => (
              <article key={title}>
                <span>{String(index + 2).padStart(2, "0")}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{body}</p>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
