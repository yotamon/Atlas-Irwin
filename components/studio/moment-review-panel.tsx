"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { reviewMoment } from "@/app/studio/moment-actions";
import type { Moment, MomentPerformanceRollup } from "@/types/moments-database";
import styles from "./moment-review-panel.module.css";

type TrackRef = { id: string; title: string; audio_url: string | null };
type LyricSource = { id: string; excerpt: string };

function time(ms: number) {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(seconds % 1 ? 1 : 0).padStart(2, "0")}`;
}

function score(value: number | null) {
  return typeof value === "number" ? Math.round(value * 100) : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function evidenceSummary(moment: Moment) {
  const evidence = objectValue(moment.evidence);
  const reasons = stringArray(evidence.reasons);
  if (reasons.length) return reasons.slice(0, 2).join(" ");
  if (typeof evidence.interpretation === "string" && evidence.interpretation.trim()) return evidence.interpretation;
  if (typeof evidence.section_label === "string") return `Detected around ${evidence.section_label}.`;
  if (evidence.agreement === "overlapping_independent_sources") return "Independent intelligence sources agree on this musical window.";
  if (typeof evidence.scene_type === "string") return `Stem-aware ${evidence.scene_type.replaceAll("_", " ")} scene.`;
  return "Source evidence is preserved and traceable to the intelligence that proposed this Moment.";
}

function sourceLabel(mode: Moment["source_mode"]) {
  if (mode === "audio") return "Track Intelligence";
  if (mode === "lyrics") return "Lyrics Intelligence";
  if (mode === "stems") return "Audio Scene";
  return "Fused evidence";
}

export function MomentReviewPanel({
  releaseId,
  moments,
  tracks,
  performance,
  lyricSources,
}: {
  releaseId: string;
  moments: Moment[];
  tracks: TrackRef[];
  performance: MomentPerformanceRollup[];
  lyricSources: LyricSource[];
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [stopMs, setStopMs] = useState<number | null>(null);

  const trackMap = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const rollupMap = useMemo(() => new Map(performance.map((item) => [item.moment_id, item])), [performance]);
  const lyricMap = useMemo(() => new Map(lyricSources.map((item) => [item.id, item.excerpt])), [lyricSources]);
  const activeMoments = useMemo(
    () => moments
      .filter((moment) => moment.state === "proposed" || moment.state === "approved")
      .sort((a, b) => {
        if (a.state !== b.state) return a.state === "proposed" ? -1 : 1;
        return b.confidence - a.confidence || a.start_ms - b.start_ms;
      }),
    [moments],
  );
  const historical = useMemo(
    () => moments
      .filter((moment) => moment.state === "rejected" || moment.state === "superseded")
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)),
    [moments],
  );
  const proposedCount = activeMoments.filter((moment) => moment.state === "proposed").length;
  const approvedCount = activeMoments.filter((moment) => moment.state === "approved").length;

  function audition(moment: Moment) {
    const audio = audioRef.current;
    const track = trackMap.get(moment.track_id);
    if (!audio || !track?.audio_url) return;
    if (activeId === moment.id && playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    if (audio.src !== track.audio_url) audio.src = track.audio_url;
    audio.currentTime = moment.start_ms / 1000;
    setActiveId(moment.id);
    setStopMs(moment.end_ms);
    void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  function card(moment: Moment, historicalMode = false) {
    const track = trackMap.get(moment.track_id);
    const rollup = rollupMap.get(moment.id);
    const lyricExcerpt = moment.lyric_moment_id ? lyricMap.get(moment.lyric_moment_id) : null;
    const changedTiming = moment.start_ms !== moment.source_start_ms || moment.end_ms !== moment.source_end_ms;
    const scores = [
      ["Hook", score(moment.hook_score)],
      ["Energy", score(moment.energy_score)],
      ["Emotion", score(moment.emotional_score)],
      ["Vocal", score(moment.vocal_score)],
      ["Unique", score(moment.uniqueness_score)],
    ].filter((entry): entry is [string, number] => typeof entry[1] === "number");

    return (
      <article className={`${styles.card} ${moment.state === "approved" ? styles.approved : ""} ${historicalMode ? styles.historicalCard : ""}`} key={moment.id}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.kickerRow}>
              <span className={styles.mode}>{sourceLabel(moment.source_mode)}</span>
              <span className={styles.state}>{moment.state}</span>
              <span>{track?.title ?? "Track"}</span>
            </div>
            <h3>{moment.label}</h3>
            <p>{evidenceSummary(moment)}</p>
          </div>
          <button
            type="button"
            className={styles.play}
            disabled={!track?.audio_url}
            onClick={() => audition(moment)}
            aria-label={`${activeId === moment.id && playing ? "Pause" : "Play"} ${moment.label}`}
          >
            {activeId === moment.id && playing ? "❚❚" : "▶"}
          </button>
        </div>

        <div className={styles.timeline}>
          <strong>{time(moment.start_ms)}–{time(moment.end_ms)}</strong>
          <span>{Math.round((moment.end_ms - moment.start_ms) / 100) / 10}s window</span>
          {changedTiming ? <small>Source: {time(moment.source_start_ms)}–{time(moment.source_end_ms)} · artist-edited</small> : <small>Matches source timing</small>}
        </div>

        <div className={styles.scoreRow}>
          <span className={styles.confidence}>{Math.round(moment.confidence * 100)} confidence</span>
          {scores.map(([label, value]) => <span key={label}>{label} {value}</span>)}
        </div>

        {moment.purpose_tags.length ? <div className={styles.tags}>{moment.purpose_tags.map((tag) => <span key={tag}>{tag.replaceAll("_", " ")}</span>)}</div> : null}
        {lyricExcerpt ? <blockquote className={styles.lyric}>“{lyricExcerpt}”<small>Live reference from Lyrics Intelligence · not copied into Moment storage</small></blockquote> : null}

        {rollup && rollup.content_items > 0 ? (
          <div className={styles.performance}>
            <strong>Observed performance</strong>
            <span>{rollup.content_items} creative{rollup.content_items === 1 ? "" : "s"}</span>
            <span>{rollup.views.toLocaleString()} views</span>
            <span>{rollup.saves.toLocaleString()} saves</span>
            <span>{rollup.follows.toLocaleString()} follows</span>
            <span>{rollup.link_clicks.toLocaleString()} clicks</span>
          </div>
        ) : null}

        {!historicalMode ? (
          <form action={reviewMoment} className={styles.reviewForm}>
            <input type="hidden" name="moment_id" value={moment.id} />
            <input type="hidden" name="release_id" value={releaseId} />
            <label>
              <span>Label</span>
              <input name="label" defaultValue={moment.label} maxLength={180} required />
            </label>
            <div className={styles.timeFields}>
              <label><span>Start · seconds</span><input name="start_seconds" type="number" min="0" step="0.1" defaultValue={(moment.start_ms / 1000).toFixed(1)} required /></label>
              <label><span>End · seconds</span><input name="end_seconds" type="number" min="0" step="0.1" defaultValue={(moment.end_ms / 1000).toFixed(1)} required /></label>
            </div>
            <div className={styles.actions}>
              <button className="button" type="submit" name="decision" value="save">Save timing</button>
              {moment.state === "proposed" ? <button className="button primary" type="submit" name="decision" value="approve">Approve Moment</button> : null}
              {moment.state === "proposed" ? <button className="button" type="submit" name="decision" value="reject">Reject</button> : null}
              {moment.state === "approved" ? <Link className="button primary" href={`/studio/production?release=${releaseId}&moment=${moment.id}`}>Create from this Moment →</Link> : null}
            </div>
          </form>
        ) : null}
      </article>
    );
  }

  return (
    <section className={styles.panel} id="moments">
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (!audio || stopMs === null || audio.currentTime * 1000 < stopMs - 35) return;
          audio.pause();
          setPlaying(false);
        }}
      />
      <div className={styles.heading}>
        <div>
          <span className="section-label">Music intelligence → creation</span>
          <h2>Moments</h2>
          <p>Ensemblis has normalized the strongest audio, lyric and stem evidence into reviewable creative starting points. Approve only the windows you want downstream systems to use.</p>
        </div>
        <div className={styles.counts}><span><strong>{proposedCount}</strong> to review</span><span><strong>{approvedCount}</strong> approved</span></div>
      </div>

      {activeMoments.length ? <div className={styles.grid}>{activeMoments.map((moment) => card(moment))}</div> : (
        <div className={styles.empty}><strong>No active Moments yet.</strong><p>Attach and analyze a canonical master, add timed lyrics, or prepare Audio Scenes. Ensemblis will materialize proposals from those existing intelligence sources automatically.</p></div>
      )}

      {historical.length ? (
        <details className={styles.history}>
          <summary>{historical.length} historical rejected or superseded Moment{historical.length === 1 ? "" : "s"}</summary>
          <div className={styles.grid}>{historical.map((moment) => card(moment, true))}</div>
        </details>
      ) : null}
    </section>
  );
}
