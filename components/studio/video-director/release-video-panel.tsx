import Link from "next/link";
import type { MusicVideoProject, Release, Track } from "@/types/database";
import {
  VIDEO_PROJECT_KIND_LABELS,
  VIDEO_PROJECT_STATUS_LABELS,
  availableBudget,
} from "@/lib/video-director/domain";
import { EmptyState, Status } from "@/components/studio/ui";
import { CreateProjectForm } from "./create-project-form";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function credits(value: number) {
  return Number(value).toLocaleString("en", { maximumFractionDigits: 2 });
}

export function ReleaseVideoPanel({
  release,
  tracks,
  projects,
}: {
  release: Release;
  tracks: Track[];
  projects: MusicVideoProject[];
}) {
  return (
    <div className="workspace-stack video-release-panel">
      <section className="workspace-section">
        <div className="section-head">
          <div>
            <span className="section-label">Video Director</span>
            <h2>Music video projects</h2>
          </div>
          <span>{projects.length} project{projects.length === 1 ? "" : "s"}</span>
        </div>

        {projects.length ? (
          <div className="video-project-grid">
            {projects.map((project) => {
              const track = tracks.find((item) => item.id === project.track_id);
              return (
                <Link href={`/studio/video/${project.id}`} className="video-project-card" key={project.id}>
                  <div className="catalog-card-badges">
                    <Status>{VIDEO_PROJECT_STATUS_LABELS[project.status]}</Status>
                    <Status>{VIDEO_PROJECT_KIND_LABELS[project.project_kind]}</Status>
                  </div>
                  <h3>{project.title}</h3>
                  <p>{track?.title ?? "Track unavailable"}</p>
                  <div className="video-project-card-meta">
                    <span>{project.primary_aspect_ratio}</span>
                    <span>{project.target_resolution}</span>
                    <span>{credits(project.spent_credits)} spent</span>
                    <span>{credits(availableBudget(project))} available</span>
                  </div>
                  <small>Created {dateLabel(project.created_at)}</small>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No music videos yet"
            body="Turn one of this release's tracks into a directed production with creative planning, budget controls, generated shots, and final delivery."
          />
        )}
      </section>

      <section className="workspace-section">
        <div className="section-head">
          <div>
            <span className="section-label">New production</span>
            <h2>Create a music video project</h2>
          </div>
        </div>
        {tracks.length ? (
          <CreateProjectForm releaseId={release.id} tracks={tracks} />
        ) : (
          <EmptyState
            title="Add a track first"
            body="Video Director starts from a canonical Atlas track so the production stays linked to the music and release context."
            href={`/studio/releases/${release.id}?tab=music`}
            label="Open Music"
          />
        )}
      </section>
    </div>
  );
}
