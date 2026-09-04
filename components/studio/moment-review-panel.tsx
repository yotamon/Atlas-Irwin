"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { reviewMoment } from "@/app/studio/moment-actions";
import type { CuratedMoment } from "@/lib/studio/moments-curator";
import type { Moment, MomentPerformanceRollup, MomentSourceMode } from "@/types/moments-database";
import styles from "./moment-review-panel.module.css";

type TrackRef = { id: string; title: string; audio_url: string | null };
type LyricSource = {
  id: string;
  track_id: string;
  section_key: string | null;
  excerpt: string;
  start_ms: number | null;
  end_ms: number | null;
  score: number | null;
};

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

function sourceName(mode: MomentSourceMode) {
  if (mode === "audio") return "track";
  if (mode === "lyrics") return "lyrics";
  if (mode === "stems") return "stems";
  return "fused";
}

function evidenceSummary(moment: CuratedMoment) {
  if (moment.curation.promoted_to_full_section && moment.curation.section_type) {
    const evidenceCount = moment.curation.candidate_count;
    return `Complete ${moment.curation.section_type.replaceAll("_", " ")} kept intact${evidenceCount > 1 ? ` after ${evidenceCount} overlapping signals agreed on this passage` : " instead of cutting the detected highlight mid-phrase"}.`;
  }
  if (moment.curation.source_modes.length > 1) {
    return `${moment.curation.source_modes.map(sourceName).join(" + ")} intelligence agrees on this musical passage.`;
  }
  const evidence = objectValue(moment.evidence);
  const reasons = stringArray(evidence.reasons);
  if (reasons.length) return reasons.slice(0, 2).join(" ");
  if (typeof evidence.interpretation === "string" && evidence.interpretation.trim()) return evidence.interpretation;
  if (typeof evidence.section_label === "string") return `Detected around ${evidence.section_label}.`;
  if (typeof evidence.scene_type === "string") return `Stem-aware ${evidence.scene_type.replaceAll("_", " ")} scene.`;
  return "Selected as one of the strongest complete, usable passages in this track.";
}

export function MomentReviewPanel({
  releaseId,
  moments,
  historicalMoments,
  rawCandidateCount,
  suppressedCount,
  tracks,
  performance,
  lyricSources,
}: {
  releaseId: string;
  moments: CuratedMoment[];
  historicalMoments: Moment[];
  rawCandidateCount: number;
  suppressedCount: number;
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
  const lyricMap = useMemo(() => new Map(lyricSources.map((item) => [item.id, item])), [lyricSources]);
  const activeMoments = useMemo(() => [...moments].sort((a, b) => a.curation.rank - b.curation.rank), [moments]);
  const proposedCount = activeMoments.filter((moment) => moment.state === "proposed").length;
  const approvedCount = activeMoments.filter((moment) => moment.state === "approved").length;

  function audition(moment: CuratedMoment) {
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

  function card(moment: CuratedMoment) {
    const track = trackMap.get(moment.track_id);
    const rollup = rollupMap.get(moment.id);
    const lyricSource = moment.lyric_moment_id ? lyricMap.get(moment.lyric_moment_id) : null;
    const scores = [
      ["Hook", score(moment.hook_score)],
      ["Energy", score(moment.energy_score)],
      ["Emotion", score(moment.emotional_score)],
      ["Vocal", score(moment.vocal_score)],
      ["Unique", score(moment.uniqueness_score)],
    ].filter((entry): entry is [string, number] => typeof entry[1] === "number");
    const durationSeconds = Math.round((moment.end_ms - moment.start_ms) / 100) / 10;

    return (
      <article className={`${styles.card} ${moment.state === "approved" ? styles.approved : ""}`} key={moment.id}>
        <div className={styles.cardTop}>
          <div>
            <div className={styles.kickerRow}>
              <span className={styles.rank}>#{moment.curation.rank}</span>
              {moment.curation.primary_hook ? <span className={styles.primaryHook}>Primary hook</span> : null}
              {moment.curation.section_type ? <span className={styles.mode}>{moment.curation.section_type.replaceAll("_", " ")}</span> : null}
              <span>{track?.title ?? "Track"}</span>
              {moment.state === "approved" ? <span className={styles.state}>approved</span> : null}
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
          <span>{durationSeconds}s</span>
          {moment.curation.promoted_to_full_section ? <small>Complete musical section · no mid-section crop</small> : null}
          {moment.curation.manual_timing ? <small>Artist timing preserved</small> : null}
        </div>

        <div className={styles.scoreRow}>
          <span className={styles.quality}>{Math.round(moment.curation.quality_score * 100)}% quality</span>
          <span>{moment.curation.source_modes.map(sourceName).join(" + ")}</span>
          {moment.curation.candidate_count > 1 ? <span>{moment.curation.candidate_count} signals fused</span> : null}
          {scores.slice(0, 3).map(([label, value]) => <span key={label}>{label} {value}</span>)}
        </div>

        {moment.purpose_tags.length ? <div className={styles.tags}>{moment.purpose_tags.slice(0, 5).map((tag) => <span key={tag}>{tag.replaceAll("_", " ")}</span>)}</div> : null}
        {lyricSource ? <blockquote className={styles.lyric}>“{lyricSource.excerpt}”<small>Timed lyric highlight inside this complete Moment</small></blockquote> : null}

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

        <div className={styles.simpleActions}>
          {moment.state === "proposed" ? (
            <form action={reviewMoment}>
              <input type="hidden" name="moment_id" value={moment.id} />
              <input type="hidden" name="release_id" value={releaseId} />
              <input type="hidden" name="label" value={moment.label} />
              <input type="hidden" name="start_seconds" value={moment.start_ms / 1000} />
              <input type="hidden" name="end_seconds" value={moment.end_ms / 1000} />
              <button className="button primary" type="submit" name="decision" value="approve">Use this Moment</button>
            </form>
          ) : null}
          {moment.state === "approved" ? <Link className="button primary" href={`/studio/production?release=${releaseId}&moment=${moment.id}`}>Create from this Moment →</Link> : null}
        </div>

        {moment.state === "proposed" ? (
          <details className={styles.editDetails}>
            <summary>Adjust or reject</summary>
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
                <button className="button" type="submit" name="decision" value="save">Save adjustment</button>
                <button className="button" type="submit" name="decision" value="reject">Reject</button>
              </div>
            </form>
          </details>
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
          <h2>Best Moments</h2>
          <p>Ensemblis combines track, lyric and stem intelligence into a few complete musical passages. Sections stay intact; short internal detections add evidence instead of becoming dozens of clips.</p>
        </div>
        <div className={styles.counts}><span><strong>{activeMoments.length}</strong> best</span><span><strong>{approvedCount}</strong> saved</span></div>
      </div>

      {activeMoments.length ? <div className={styles.grid}>{activeMoments.map((moment) => card(moment))}</div> : (
        <div className={styles.empty}><strong>No strong complete Moments yet.</strong><p>Ensemblis will show fewer than five rather than surface weak or badly bounded clips. Analyze the canonical master, lyrics or stems to add stronger evidence.</p></div>
      )}

      {rawCandidateCount > activeMoments.length ? (
        <details className={styles.analysisDetails}>
          <summary>Analysis evidence · {rawCandidateCount} raw candidates → {activeMoments.length} Best Moments</summary>
          <p>{suppressedCount} redundant, overlapping or lower-quality candidates were kept out of the artist workflow. They remain analysis evidence and do not need manual review.</p>
        </details>
      ) : null}

      {historicalMoments.length ? (
        <details className={styles.history}>
          <summary>{historicalMoments.length} historical rejected or superseded candidate{historicalMoments.length === 1 ? "" : "s"}</summary>
          <div className={styles.historyList}>
            {historicalMoments.slice(0, 30).map((moment) => (
              <div className={styles.historyRow} key={moment.id}>
                <span>{moment.label}</span>
                <small>{time(moment.start_ms)}–{time(moment.end_ms)} · {moment.state}</small>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
