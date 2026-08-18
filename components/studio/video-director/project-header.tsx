import Link from "next/link";
import { archiveMusicVideoProject } from "@/app/studio/video-actions";
import {
  VIDEO_PROJECT_KIND_LABELS,
  VIDEO_PROJECT_STATUS_LABELS,
} from "@/lib/video-director/domain";
import { projectStageForStatus } from "@/lib/video-director/state";
import type { MusicVideoProject, Release, Track } from "@/types/database";
import { ConfirmButton } from "@/components/studio/submit-button";
import { Status } from "@/components/studio/ui";
import { BudgetMeter } from "./budget-meter";

export function ProjectHeader({
  project,
  release,
  track,
}: {
  project: MusicVideoProject;
  release: Release;
  track: Track;
}) {
  const stage = projectStageForStatus(project.status);

  return (
    <header className="video-project-header">
      <div className="video-project-heading">
        <Link href={`/studio/releases/${release.id}?tab=video`} className="text-button">
          ← {release.title}
        </Link>
        <div className="catalog-card-badges">
          <Status>{VIDEO_PROJECT_STATUS_LABELS[project.status]}</Status>
          <Status>{VIDEO_PROJECT_KIND_LABELS[project.project_kind]}</Status>
        </div>
        <h1>{project.title}</h1>
        <p>{track.title} · {project.primary_aspect_ratio} · {project.target_resolution} · {stage.replaceAll("_", " ")}</p>
      </div>

      <div className="video-project-header-side">
        <BudgetMeter project={project} />
        {project.status !== "archived" ? (
          <form action={archiveMusicVideoProject}>
            <input type="hidden" name="id" value={project.id} />
            <ConfirmButton message="Archive this music video project? You can still view its production history later.">
              Archive project
            </ConfirmButton>
          </form>
        ) : null}
      </div>
    </header>
  );
}
