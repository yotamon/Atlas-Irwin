"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  analyzeMusicVideoTrack,
  useFallbackMusicAnalysis,
} from "@/app/studio/video-pipeline-actions";
import { SubmitButton } from "@/components/studio/submit-button";
import { Status } from "@/components/studio/ui";
import {
  parseMusicMap,
  type MusicHookCandidate,
  type MusicMapSection,
} from "@/lib/video-director/creative-director";
import type { VideoWorkspaceData } from "./workspace-types";
import styles from "./track-intelligence-inspector.module.css";

type WindowSelection = {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
  kind: "section" | "hook";
};

function time(ms: number) {
  const totalSeconds = Math.max(0, ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const tenths = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function percentage(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function sectionSelection(section: MusicMapSection): WindowSelection {
  return {
    id: section.id,
    label: section.label,
    startMs: section.start_ms,
    endMs: section.end_ms,
    kind: "section",
  };
}

function hookSelection(hook: MusicHookCandidate): WindowSelection {
  return {
    id: hook.id,
    label: hook.label,
    startMs: hook.start_ms,
    endMs: hook.end_ms,
    kind: "hook",
  };
}

function metricLabel(key: string) {
  return ({
    repetition: "Repetition",
    structure: "Structure",
    energy_lift: "Energy lift",
    energy: "Energy",
    novelty: "Novelty",
    onset_density: "Groove",
    melodic_salience: "Melodic",
    boundary_fit: "Bar fit",
    loopability: "Loop",
  } as Record<string, string>)[key] ?? key;
}

export function TrackIntelligenceInspector({ data }: { data: VideoWorkspaceData }) {
  const map = parseMusicMap(data.project.music_map);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [selection, setSelection] = useState<WindowSelection | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const analyzing = data.project.status === "analyzing_audio";

  const hooks = useMemo(
    () => [...(map?.hook_candidates ?? [])].sort((a, b) => b.score - a.score),
    [map],
  );
  const socialCutIds = useMemo(
    () => new Map(
      Object.entries(map?.social_cuts ?? {})
        .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1]))
        .map(([duration, cut]) => [cut.candidate_id, duration]),
    ),
    [map],
  );

  function playWindow(next: WindowSelection) {
    setSelection(next);
    const audio = audioRef.current;
    if (!audio || !data.audioUrl) return;
    audio.currentTime = next.startMs / 1000;
    setPlayheadMs(next.startMs);
    void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  function toggleSelection(next: WindowSelection) {
    const audio = audioRef.current;
    if (selection?.id === next.id && playing && audio) {
      audio.pause();
      setPlaying(false);
      return;
    }
    playWindow(next);
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) return;
    const currentMs = audio.currentTime * 1000;
    setPlayheadMs(currentMs);
    if (selection && currentMs >= selection.endMs - 30) {
      audio.pause();
      audio.currentTime = selection.startMs / 1000;
      setPlayheadMs(selection.startMs);
      setPlaying(false);
    }
  }

  if (!map) {
    return (
      <section className="workspace-section" id="music-map">
        <div className="section-head">
          <div><span className="section-label">Music intelligence</span><h2>Understand the track before directing it</h2></div>
          <Status>Not analyzed</Status>
        </div>
        <div className={styles.empty}>
          <div>
            <h3>Build the musical edit map</h3>
            <p>Atlas will detect structure, beats, real downbeats when available, energy, recurring material, hook candidates and short-form cuts.</p>
          </div>
          <form action={analyzeMusicVideoTrack}>
            <input type="hidden" name="project_id" value={data.project.id} />
            <SubmitButton pendingLabel="Analyzing track...">Analyze track</SubmitButton>
          </form>
        </div>
      </section>
    );
  }

  const fullAnalysis = map.source === "worker" && map.analysis?.quality === "full";
  const analysisLabel = fullAnalysis
    ? "Semantic analysis"
    : map.source === "worker"
      ? "Audio fallback"
      : "Estimated map";
  const selectedHook = selection?.kind === "hook"
    ? hooks.find((hook) => hook.id === selection.id) ?? null
    : null;
  const playheadPercent = map.duration_ms > 0 ? Math.max(0, Math.min(100, (playheadMs / map.duration_ms) * 100)) : 0;

  return (
    <section className="workspace-section" id="music-map">
      <audio
        ref={audioRef}
        src={data.audioUrl ?? undefined}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onEnded={() => setPlaying(false)}
      />

      <div className="section-head">
        <div>
          <span className="section-label">Music intelligence</span>
          <h2>Hear exactly how Atlas understands the track</h2>
        </div>
        <Status>{analysisLabel}</Status>
      </div>

      <div className={styles.summary}>
        <div><small>BPM</small><strong>{map.bpm ?? "—"}</strong></div>
        <div><small>Duration</small><strong>{time(map.duration_ms)}</strong></div>
        <div><small>Sections</small><strong>{map.sections.length}</strong></div>
        <div><small>Hook candidates</small><strong>{hooks.length || "—"}</strong></div>
        <div><small>Downbeats</small><strong>{map.downbeats_ms.length || "—"}</strong></div>
      </div>

      <div className={styles.analysisMeta}>
        <div>
          <strong>{map.analysis?.engine ?? (map.source === "worker" ? "Legacy worker" : "Duration estimate")}</strong>
          <span>{map.analysis?.model ? ` · ${map.analysis.model}` : ""}</span>
        </div>
        <div className={styles.metaFlags}>
          <span>{map.analysis?.semantic_structure ? "Semantic sections" : "Generic sections"}</span>
          <span>{map.analysis?.real_downbeats ? "Detected downbeats" : "No verified downbeats"}</span>
          <span>Map v{map.version}</span>
        </div>
      </div>

      <div className={styles.energy} aria-label="Track energy curve">
        {map.energy_curve.slice(0, 120).map((point, index) => (
          <span
            key={`${point.ms}-${index}`}
            style={{ height: `${Math.max(4, point.value * 100)}%` }}
            title={`${time(point.ms)} · ${percentage(point.value)} energy`}
          />
        ))}
        <i className={styles.playhead} style={{ left: `${playheadPercent}%` }} />
      </div>

      <div className={styles.timeline} aria-label="Detected track sections">
        {map.sections.map((section) => {
          const active = selection?.id === section.id;
          const width = Math.max(3, ((section.end_ms - section.start_ms) / map.duration_ms) * 100);
          return (
            <button
              type="button"
              key={section.id}
              className={active ? styles.sectionActive : styles.section}
              style={{ width: `${width}%` }}
              onClick={() => toggleSelection(sectionSelection(section))}
              title={`Play ${section.label}`}
            >
              <strong>{active && playing ? "❚❚ " : "▶ "}{section.label}</strong>
              <small>{time(section.start_ms)}–{time(section.end_ms)}</small>
              <em>{percentage(section.energy)}</em>
            </button>
          );
        })}
      </div>

      {!data.audioUrl ? (
        <p className={styles.warning}>The structure is available, but Atlas could not resolve a playable master URL for this track. Attach a master/audio preview to enable section playback.</p>
      ) : null}

      <div className={styles.splitHeading}>
        <div>
          <span className="section-label">Ranked hooks</span>
          <h3>Short-form candidates</h3>
          <p>These are musical windows, not “the loudest part”. Atlas scores recurrence, structure, lift, groove, melodic identity, edit boundaries and loop quality.</p>
        </div>
        {hooks[0] ? <span className={styles.primaryScore}>Best {Math.round(hooks[0].score * 100)}</span> : null}
      </div>

      {hooks.length ? (
        <div className={styles.hooks}>
          {hooks.map((hook, index) => {
            const active = selection?.id === hook.id;
            const socialDuration = socialCutIds.get(hook.id);
            return (
              <article key={hook.id} className={active ? styles.hookActive : styles.hook}>
                <button type="button" className={styles.hookPlay} onClick={() => toggleSelection(hookSelection(hook))}>
                  <span>{active && playing ? "❚❚" : "▶"}</span>
                  <div>
                    <strong>#{index + 1} {hook.label}</strong>
                    <small>{time(hook.start_ms)}–{time(hook.end_ms)} · {(hook.duration_ms / 1000).toFixed(1)}s</small>
                  </div>
                </button>
                <div className={styles.score}><strong>{Math.round(hook.score * 100)}</strong><small>hook score</small></div>
                <div className={styles.hookBadges}>
                  <span>{hook.kind.replaceAll("_", " ")}</span>
                  {socialDuration ? <span>{socialDuration}s social cut</span> : null}
                  <span>{hook.section_label}</span>
                </div>
                <div className={styles.reasons}>
                  {hook.reasons.map((reason) => <span key={reason}>{reason}</span>)}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.noHooks}>
          <strong>No scored hooks in this map.</strong>
          <p>{map.source === "fallback" ? "Estimated maps intentionally do not invent hooks. Run real analysis to generate candidates." : "This is likely a legacy v1 analysis. Re-run the track to upgrade it to Music Intelligence v2."}</p>
        </div>
      )}

      {selectedHook ? (
        <div className={styles.metricPanel}>
          <div>
            <span className="section-label">Why this hook</span>
            <h3>{selectedHook.label}</h3>
          </div>
          <div className={styles.metrics}>
            {Object.entries(selectedHook.metrics).map(([key, value]) => (
              <div key={key}>
                <span><small>{metricLabel(key)}</small><strong>{Math.round(value * 100)}</strong></span>
                <i><b style={{ width: `${value * 100}%` }} /></i>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {map.social_cuts ? (
        <div className={styles.socialCuts}>
          <div><span className="section-label">Ready-to-use windows</span><h3>Social cuts</h3></div>
          {Object.entries(map.social_cuts).map(([duration, cut]) => (
            cut ? (
              <button
                type="button"
                key={duration}
                onClick={() => toggleSelection({
                  id: `social-${duration}-${cut.candidate_id}`,
                  label: `${duration}s · ${cut.label}`,
                  startMs: cut.start_ms,
                  endMs: cut.end_ms,
                  kind: "hook",
                })}
              >
                <strong>{duration}s</strong>
                <span>{cut.label}</span>
                <small>{time(cut.start_ms)}–{time(cut.end_ms)}</small>
              </button>
            ) : null
          ))}
        </div>
      ) : null}

      {map.analysis?.warnings?.length ? (
        <details className={styles.diagnostics}>
          <summary>Analysis diagnostics ({map.analysis.warnings.length})</summary>
          {map.analysis.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </details>
      ) : null}

      {map.source === "fallback" && data.services.worker.configured ? (
        <form action={analyzeMusicVideoTrack} className={styles.inlineAction}>
          <input type="hidden" name="project_id" value={data.project.id} />
          <SubmitButton pendingLabel="Running real analysis...">Replace estimate with real analysis</SubmitButton>
        </form>
      ) : null}

      {map.source === "worker" && map.version < 2 && data.services.worker.configured ? (
        <form action={analyzeMusicVideoTrack} className={styles.inlineAction}>
          <input type="hidden" name="project_id" value={data.project.id} />
          <SubmitButton pendingLabel="Upgrading analysis...">Upgrade this track to v2</SubmitButton>
        </form>
      ) : null}

      {analyzing ? (
        <div className={styles.processing}>
          <span />
          <div><strong>Deep music analysis is running</strong><p>The job is durable. Atlas will refresh to semantic sections and ranked hooks when the worker completes.</p></div>
          <Link className="button" href={`/studio/video/${data.project.id}`}>Refresh</Link>
          <form action={useFallbackMusicAnalysis}>
            <input type="hidden" name="project_id" value={data.project.id} />
            <SubmitButton className="text-button" pendingLabel="Switching...">Use estimate instead</SubmitButton>
          </form>
        </div>
      ) : null}
    </section>
  );
}
