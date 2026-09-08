"use client";

import { useMemo, useState } from "react";
import { createMusicVideoProject } from "@/app/studio/video-actions";
import { SubmitButton } from "@/components/studio/submit-button";
import { Field } from "@/components/studio/ui";
import {
  QUICK_VIDEO_DEFAULT_BUDGET_CREDITS,
  buildQuickVideoConcepts,
  type QuickVideoConceptId,
} from "@/lib/video-director/quick-video";
import {
  VIDEO_PRODUCTION_PROFILE_DEFINITIONS,
  VIDEO_PRODUCTION_PROFILES,
  type VideoProductionProfile,
} from "@/lib/video-director/production-profile";
import type {
  VideoAspectRatio,
  VideoPeopleMode,
  VideoProjectKind,
  VideoResolution,
  VideoStoryMode,
} from "@/lib/video-director/domain";
import type { Release, Track } from "@/types/database";
import type { Moment } from "@/types/moments-database";

function profileForIndex(index: number): VideoProductionProfile {
  return VIDEO_PRODUCTION_PROFILES[index] ?? "balanced";
}

export function CreateProjectForm({
  release,
  tracks,
  moments,
}: {
  release: Release;
  tracks: Track[];
  moments: Moment[];
}) {
  const initialTrack = tracks.find((track) => track.is_primary) ?? tracks[0];
  const [trackId, setTrackId] = useState(initialTrack?.id ?? "");
  const [title, setTitle] = useState(initialTrack ? `${initialTrack.title} Music Video` : "Music Video");
  const [titleEdited, setTitleEdited] = useState(false);
  const [conceptId, setConceptId] = useState<QuickVideoConceptId>("hook_world");
  const [projectKind, setProjectKind] = useState<VideoProjectKind>("full_music_video");
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>("16:9");
  const [resolution, setResolution] = useState<VideoResolution>("1080p");
  const [storyMode, setStoryMode] = useState<VideoStoryMode>("hybrid");
  const [peopleMode, setPeopleMode] = useState<VideoPeopleMode>("director_choice");
  const [productionProfile, setProductionProfile] = useState<VideoProductionProfile>("balanced");
  const [maxBudgetUsd, setMaxBudgetUsd] = useState("");

  const selectedTrack = useMemo(
    () => tracks.find((track) => track.id === trackId) ?? initialTrack,
    [initialTrack, trackId, tracks],
  );
  const concepts = useMemo(
    () => selectedTrack ? buildQuickVideoConcepts({ release, track: selectedTrack, moments }) : [],
    [moments, release, selectedTrack],
  );
  const selectedConcept = concepts.find((concept) => concept.id === conceptId) ?? concepts[0] ?? null;
  const productionIndex = Math.max(0, VIDEO_PRODUCTION_PROFILES.indexOf(productionProfile));
  const productionDefinition = VIDEO_PRODUCTION_PROFILE_DEFINITIONS[productionIndex] ?? VIDEO_PRODUCTION_PROFILE_DEFINITIONS[2];

  function chooseConcept(nextId: QuickVideoConceptId) {
    const next = concepts.find((concept) => concept.id === nextId);
    setConceptId(nextId);
    if (!next) return;
    setProjectKind(next.projectKind);
    setAspectRatio(next.aspectRatio);
    setResolution(next.resolution);
    setStoryMode(next.storyMode);
    setPeopleMode(next.peopleMode);
  }

  return (
    <form action={createMusicVideoProject} className="studio-form video-create-form">
      <input type="hidden" name="release_id" value={release.id} />
      <input type="hidden" name="production_profile" value={productionProfile} />

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
      </div>

      <div className="workspace-stack">
        <div className="section-head">
          <div>
            <span className="section-label">Quick Video · 1 of 3</span>
            <h3>Choose the creative direction</h3>
          </div>
          <span>Music-aware, editable later</span>
        </div>
        <div className="video-project-grid" role="radiogroup" aria-label="Quick Video creative direction">
          {concepts.map((concept) => {
            const active = concept.id === conceptId;
            return (
              <label className="video-project-card" key={concept.id}>
                <input
                  type="radio"
                  name="quick_video_concept"
                  value={concept.id}
                  checked={active}
                  onChange={() => chooseConcept(concept.id)}
                />
                <span className="section-label">{concept.eyebrow}</span>
                <h3>{concept.title}</h3>
                <p>{concept.description}</p>
                <small>{concept.rationale}</small>
              </label>
            );
          })}
        </div>
      </div>

      <section className="video-create-quality" aria-labelledby="create-video-quality-title">
        <div className="section-head">
          <div>
            <span className="section-label">Quick Video · 2 of 3</span>
            <h3 id="create-video-quality-title">Set production quality</h3>
          </div>
          <span>{productionDefinition.label}</span>
        </div>
        <p className="section-copy">This controls how aggressively Ensemblis chooses premium models. The exact provider, model and price for every shot appear as soon as the storyboard exists, before any paid generation.</p>
        <div className="video-quality-slider video-quality-slider--create">
          <div className="video-quality-slider__labels" role="group" aria-label="Production quality presets">
            {VIDEO_PRODUCTION_PROFILE_DEFINITIONS.map((item, index) => (
              <button
                type="button"
                key={item.id}
                className={index === productionIndex ? "active" : ""}
                aria-pressed={index === productionIndex}
                onClick={() => setProductionProfile(profileForIndex(index))}
              >
                <span>{item.eyebrow}</span>
                <strong>{item.label}</strong>
              </button>
            ))}
          </div>
          <input
            type="range"
            aria-label="Production quality"
            aria-valuetext={productionDefinition.label}
            min={0}
            max={VIDEO_PRODUCTION_PROFILES.length - 1}
            step={1}
            value={productionIndex}
            onChange={(event) => setProductionProfile(profileForIndex(Number(event.target.value)))}
          />
          <div className="video-quality-slider__selection" aria-live="polite">
            <div><span>{productionDefinition.eyebrow}</span><strong>{productionDefinition.label}</strong></div>
            <p>{productionDefinition.description}</p>
          </div>
        </div>
        <div className="video-budget-cap video-budget-cap--create">
          <div>
            <label htmlFor="create-video-max-budget">Maximum spend <span>optional</span></label>
            <p>A safety ceiling in USD. It does not choose the creative quality for you.</p>
          </div>
          <div className="video-budget-cap__input">
            <span>$</span>
            <input
              id="create-video-max-budget"
              name="max_budget_usd"
              type="number"
              min="1"
              max="100000"
              step="1"
              inputMode="decimal"
              placeholder="No USD cap"
              value={maxBudgetUsd}
              onChange={(event) => setMaxBudgetUsd(event.target.value)}
            />
          </div>
          <div className="video-budget-cap__state" aria-live="polite">
            <strong>{maxBudgetUsd ? `Never exceed $${Number(maxBudgetUsd || 0).toLocaleString("en-US")}` : "No USD ceiling"}</strong>
            <span>Every paid batch still requires explicit approval.</span>
          </div>
        </div>
      </section>

      <Field label="Anything Ensemblis should protect or avoid?" wide>
        <textarea
          name="creative_note"
          maxLength={4000}
          rows={3}
          placeholder={selectedConcept
            ? `Optional. Add a constraint, reference or non-negotiable for “${selectedConcept.title}”.`
            : `Optional creative context for ${selectedTrack?.title ?? "this track"}.`}
        />
      </Field>

      <details className="workspace-section">
        <summary><strong>Director Pro settings</strong> · format, story mode and technical safety</summary>
        <div className="form-grid">
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
            <select
              name="project_kind"
              value={projectKind}
              onChange={(event) => setProjectKind(event.target.value as VideoProjectKind)}
            >
              <option value="full_music_video">Full music video</option>
              <option value="teaser">Teaser</option>
            </select>
          </Field>
          <Field label="Primary format">
            <select
              name="primary_aspect_ratio"
              value={aspectRatio}
              onChange={(event) => setAspectRatio(event.target.value as VideoAspectRatio)}
            >
              <option value="16:9">16:9 landscape</option>
              <option value="9:16">9:16 vertical</option>
              <option value="1:1">1:1 square</option>
            </select>
          </Field>
          <Field label="Target resolution">
            <select
              name="target_resolution"
              value={resolution}
              onChange={(event) => setResolution(event.target.value as VideoResolution)}
            >
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
              <option value="4k">4K</option>
            </select>
          </Field>
          <Field label="Story mode">
            <select
              name="story_mode"
              value={storyMode}
              onChange={(event) => setStoryMode(event.target.value as VideoStoryMode)}
            >
              <option value="narrative">Narrative</option>
              <option value="abstract">Abstract</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </Field>
          <Field label="People">
            <select
              name="people_mode"
              value={peopleMode}
              onChange={(event) => setPeopleMode(event.target.value as VideoPeopleMode)}
            >
              <option value="director_choice">Director choice</option>
              <option value="prefer_people">Prefer people</option>
              <option value="no_people">No people</option>
            </select>
          </Field>
          <Field label="Provider credit safety cap">
            <input
              name="hard_budget_credits"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              defaultValue={QUICK_VIDEO_DEFAULT_BUDGET_CREDITS}
              required
            />
          </Field>
        </div>
        <p className="video-credit-cap-note">This provider-level cap is a secondary technical guardrail. The optional USD ceiling above is the clear user-facing spend limit.</p>
      </details>

      <div className="video-create-actions">
        <small>Planning is free. Ensemblis will show the exact model routing and estimated cost before any generation approval.</small>
        <SubmitButton>Plan Quick Video</SubmitButton>
      </div>
    </form>
  );
}
