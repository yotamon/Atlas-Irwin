import Link from "next/link";
import type { MusicVideoProject, Release, Track } from "@/types/database";
import type { Moment } from "@/types/moments-database";
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
  moments,
}: {
  release: Release;
  tracks: Track[];
  projects: MusicVideoProject[];
  moments: Moment[];
}) {
  return (
    <div className="workspace-stack video-release-panel">
      <section className="workspace-section">
        <div className="section-head">
          <div>
            <span className="section-label">Video</span>
            <h2>Productions</h2>
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
            title="No video production yet"
            body="Start with Quick Video. Ensemblis turns the release identity and strongest approved music Moments into a few concrete creative directions before any generation spend."
          />
        )}
      </section>

      <section className="workspace-section">
        <div className="section-head">
          <div>
            <span className="section-label">Quick Video</span>
            <h2>Choose a direction, then let Ensemblis plan the production</h2>
          </div>
          <span>Director Pro stays available inside the setup</span>
        </div>
        {tracks.length ? (
          <CreateProjectForm release={release} tracks={tracks} moments={moments} />
        ) : (
          <EmptyState
            title="Add a track first"
            body="Quick Video starts from a canonical track so concepts, edit decisions, spend and final delivery stay attached to the music."
            href={`/studio/releases/${release.id}?tab=music`}
            label="Open Music"
          />
        )}
      </section>
    </div>
  );
}
