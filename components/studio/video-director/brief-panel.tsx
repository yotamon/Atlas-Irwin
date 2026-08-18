import { updateMusicVideoProjectBrief } from "@/app/studio/video-actions";
import { Field, FormatTime, Submit } from "@/components/studio/ui";
import {
  parseVideoCreativeBrief,
  VIDEO_PEOPLE_MODE_LABELS,
  VIDEO_STORY_MODE_LABELS,
} from "@/lib/video-director/domain";
import type { MusicVideoProject, Release, Track } from "@/types/database";

function contextState(available: boolean, label: string) {
  return (
    <span className={available ? "available" : "missing"}>
      <strong>{available ? "✓" : "!"}</strong>
      {label}
    </span>
  );
}

export function BriefPanel({
  project,
  release,
  track,
  hasAudio,
  hasArtwork,
  hasReleaseIdentity,
}: {
  project: MusicVideoProject;
  release: Release;
  track: Track;
  hasAudio: boolean;
  hasArtwork: boolean;
  hasReleaseIdentity: boolean;
}) {
  const brief = parseVideoCreativeBrief(project.creative_brief);
  const archived = project.status === "archived";

  return (
    <section className="workspace-section video-brief-panel">
      <div className="section-head">
        <div>
          <span className="section-label">Project brief</span>
          <h2>Track-first production context</h2>
        </div>
        <span>{archived ? "Read only" : "Editable"}</span>
      </div>

      <div className="video-context-grid">
        <article>
          <small>Track</small>
          <strong>{track.title}</strong>
          <span><FormatTime seconds={track.duration} /></span>
        </article>
        <article>
          <small>Release</small>
          <strong>{release.title}</strong>
          <span>{release.release_type}</span>
        </article>
        <article className="video-context-signals">
          <small>Atlas context</small>
          {contextState(hasReleaseIdentity, "Release identity")}
          {contextState(hasArtwork, "Artwork")}
          {contextState(Boolean(release.visual_direction), "Visual direction")}
          {contextState(hasAudio, "Audio")}
        </article>
      </div>

      <form action={updateMusicVideoProjectBrief} className="studio-form">
        <input type="hidden" name="id" value={project.id} />
        <div className="form-grid">
          <Field label="Project title">
            <input name="title" required maxLength={160} defaultValue={project.title} disabled={archived} />
          </Field>
          <Field label="Primary format">
            <select name="primary_aspect_ratio" defaultValue={project.primary_aspect_ratio} disabled={archived}>
              <option value="16:9">16:9 landscape</option>
              <option value="9:16">9:16 vertical</option>
              <option value="1:1">1:1 square</option>
            </select>
          </Field>
          <Field label="Target quality">
            <select name="target_resolution" defaultValue={project.target_resolution} disabled={archived}>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
              <option value="4k">4K</option>
            </select>
          </Field>
          <Field label="Hard generation budget">
            <input
              name="hard_budget_credits"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              defaultValue={project.hard_budget_credits}
              disabled={archived}
              readOnly={project.spent_credits > 0}
            />
          </Field>
          <Field label="Story mode">
            <select name="story_mode" defaultValue={brief.story_mode} disabled={archived}>
              {Object.entries(VIDEO_STORY_MODE_LABELS).map(([key, label]) => (
                <option value={key} key={key}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="People">
            <select name="people_mode" defaultValue={brief.people_mode} disabled={archived}>
              {Object.entries(VIDEO_PEOPLE_MODE_LABELS).map(([key, label]) => (
                <option value={key} key={key}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Creative note" wide>
            <textarea
              name="creative_note"
              rows={5}
              maxLength={4000}
              defaultValue={brief.note}
              disabled={archived}
              placeholder="What should the director know before listening and planning?"
            />
          </Field>
        </div>
        {!archived ? <Submit>Save project brief</Submit> : null}
      </form>
    </section>
  );
}
