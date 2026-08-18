"use client";

import { useMemo, useState } from "react";
import { createMusicVideoProject } from "@/app/studio/video-actions";
import { SubmitButton } from "@/components/studio/submit-button";
import { Field } from "@/components/studio/ui";
import type { Track } from "@/types/database";

export function CreateProjectForm({
  releaseId,
  tracks,
}: {
  releaseId: string;
  tracks: Track[];
}) {
  const initialTrack = tracks.find((track) => track.is_primary) ?? tracks[0];
  const [trackId, setTrackId] = useState(initialTrack?.id ?? "");
  const [title, setTitle] = useState(initialTrack ? `${initialTrack.title} Music Video` : "Music Video");
  const [titleEdited, setTitleEdited] = useState(false);
  const selectedTrack = useMemo(
    () => tracks.find((track) => track.id === trackId) ?? initialTrack,
    [initialTrack, trackId, tracks],
  );

  return (
    <form action={createMusicVideoProject} className="studio-form video-create-form">
      <input type="hidden" name="release_id" value={releaseId} />
      <div className="form-grid">
        <Field label="Track">
          <select
            name="track_id"
            required
            value={trackId}
            onChange={(event) => {
              const nextId = event.target.value;
              const nextTrack = tracks.find((track) => track.id === nextId);
              setTrackId(nextId);
              if (!titleEdited && nextTrack) setTitle(`${nextTrack.title} Music Video`);
            }}
          >
            {tracks.map((track) => (
              <option value={track.id} key={track.id}>{track.title}</option>
            ))}
          </select>
        </Field>
        <Field label="Project title">
          <input
            name="title"
            required
            maxLength={160}
            value={title}
            onChange={(event) => {
              setTitleEdited(true);
              setTitle(event.target.value);
            }}
          />
        </Field>
        <Field label="Target">
          <select name="project_kind" defaultValue="full_music_video">
            <option value="full_music_video">Full music video</option>
            <option value="teaser">Teaser</option>
          </select>
        </Field>
        <Field label="Primary format">
          <select name="primary_aspect_ratio" defaultValue="16:9">
            <option value="16:9">16:9 landscape</option>
            <option value="9:16">9:16 vertical</option>
            <option value="1:1">1:1 square</option>
          </select>
        </Field>
        <Field label="Target quality">
          <select name="target_resolution" defaultValue="1080p">
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="4k">4K</option>
          </select>
        </Field>
        <Field label="Hard generation budget">
          <input name="hard_budget_credits" type="number" min="0" max="100000" step="0.01" defaultValue="250" required />
        </Field>
        <Field label="Story mode">
          <select name="story_mode" defaultValue="hybrid">
            <option value="narrative">Narrative</option>
            <option value="abstract">Abstract</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </Field>
        <Field label="People">
          <select name="people_mode" defaultValue="director_choice">
            <option value="director_choice">Director choice</option>
            <option value="prefer_people">Prefer people</option>
            <option value="no_people">No people</option>
          </select>
        </Field>
        <Field label="Creative note" wide>
          <textarea
            name="creative_note"
            maxLength={4000}
            rows={4}
            placeholder={`Anything the director should know about ${selectedTrack?.title ?? "this track"}?`}
          />
        </Field>
      </div>
      <div className="video-create-actions">
        <small>No AI or generation credits are used when creating a project.</small>
        <SubmitButton>Create project</SubmitButton>
      </div>
    </form>
  );
}
