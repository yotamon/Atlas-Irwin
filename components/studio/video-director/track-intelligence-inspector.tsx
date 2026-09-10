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
  type MusicMomentIntent,
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

const INTENT_LABELS: Record<MusicMomentIntent, string> = {
  instant_hook: "Instant hook",
  musical_identity: "Musical identity",
  groove_loop: "Groove loop",
  build_drop: "Build → drop",
  climax: "Climax",
  story_arc: "Story arc",
};

const METRIC_ORDER = [
  "semantic_recurrence",
  "harmonic_recurrence",
  "structure",
  "energy_lift",
  "energy",
  "arc_strength",
  "onset_density",
  "groove_stability",
  "harmonic_distinctiveness",
  "boundary_fit",
  "boundary_loop_fit",
  "segment_confidence",
] as const;

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
    semantic_recurrence: "Semantic recurrence",
    harmonic_recurrence: "Harmonic recurrence",
    structure: "Structure",
    energy_lift: "Energy lift",
    energy: "Energy",
    arc_strength: "Arc strength",
    novelty: "Novelty",
    onset_density: "Rhythmic activity",
    groove_stability: "Groove stability",
    harmonic_distinctiveness: "Harmonic identity",
    boundary_fit: "Edit-grid fit",
    boundary_loop_fit: "Loop boundary fit",
    segment_confidence: "Segment confidence",
    repetition: "Recurrence (legacy)",
    melodic_salience: "Harmonic identity (legacy)",
    loopability: "Loop fit (legacy)",
  } as Record<string, string>)[key] ?? key;
}

function downbeatLabel(source: string | undefined, count: number) {
  if (source === "model") return `${count} detected downbeats`;
  if (source === "inferred_from_beats") return `${count} inferred bar-grid points`;
  if (source === "synthetic_grid") return `${count} synthetic grid points`;
  return "No verified downbeats";
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
  const hookById = useMemo(() => new Map(hooks.map((hook) => [hook.id, hook])), [hooks]);
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
          <div><span className="section-label">Track Intelligence</span><h2>Understand the track before directing it</h2></div>
          <Status>Not analyzed</Status>
        </div>
        <div className={styles.empty}>
          <div>
            <h3>Build the production-grade musical map</h3>
            <p>Atlas will detect structure, rhythm provenance, bars and phrases, production moments, short-form alternatives and master QC before media generation starts.</p>
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
    ? hookById.get(selection.id) ?? null
    : null;
  const playheadPercent = map.duration_ms > 0 ? Math.max(0, Math.min(100, (playheadMs / map.duration_ms) * 100)) : 0;
  const confidence = map.analysis?.confidence;
  const qc = map.master_qc;
  const momentEntries = Object.entries(map.moments ?? {})
    .map(([intent, refs]) => ({ intent: intent as MusicMomentIntent, ref: refs?.[0] }))
    .filter((entry): entry is { intent: MusicMomentIntent; ref: NonNullable<typeof entry.ref> } => Boolean(entry.ref));
  const selectedMetrics = selectedHook
    ? METRIC_ORDER.flatMap((key) => {
        const value = selectedHook.metrics[key];
        return typeof value === "number" ? [[key, value] as const] : [];
      })
    : [];

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
          <span className="section-label">Track Intelligence</span>
          <h2>Hear exactly what Atlas will use to direct media</h2>
        </div>
        <Status>{analysisLabel}</Status>
      </div>

      <div className={styles.summary}>
        <div><small>BPM</small><strong>{map.bpm ?? "—"}</strong></div>
        <div><small>Duration</small><strong>{time(map.duration_ms)}</strong></div>
        <div><small>Sections</small><strong>{map.sections.length}</strong></div>
        <div><small>Production moments</small><strong>{momentEntries.length || "—"}</strong></div>
        <div><small>Confidence</small><strong>{confidence ? percentage(confidence.overall) : "—"}</strong></div>
      </div>

      <div className={styles.analysisMeta}>
        <div>
          <strong>{map.analysis?.engine ?? (map.source === "worker" ? "Legacy worker" : "Duration estimate")}</strong>
          <span>{map.analysis?.model ? ` · ${map.analysis.model}` : ""}</span>
        </div>
        <div className={styles.metaFlags}>
          <span>{map.analysis?.semantic_structure ? "Semantic sections" : "Generic sections"}</span>
          <span>{downbeatLabel(map.analysis?.downbeat_source ?? map.downbeat_source, map.downbeats_ms.length)}</span>
          {map.analysis?.embeddings_used ? <span>Semantic embeddings</span> : null}
          {map.bars?.length ? <span>{map.bars.length} bars</span> : null}
          {map.phrases?.length ? <span>{map.phrases.length} phrases</span> : null}
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
              <em>{percentage(section.energy)} energy{typeof section.confidence === "number" ? ` · ${percentage(section.confidence)} confidence` : ""}</em>
            </button>
          );
        })}
      </div>

      {!data.audioUrl ? (
        <p className={styles.warning}>The structure is available, but Atlas could not resolve a playable master URL for this track. Attach a master/audio preview to enable auditioning.</p>
      ) : null}

      {momentEntries.length ? (
        <>
          <div className={styles.splitHeading}>
            <div>
              <span className="section-label">Production intent</span>
              <h3>Different moments for different creative jobs</h3>
              <p>A six-second hook, a seamless groove loop and a thirty-second story are no longer treated as the same optimization problem.</p>
            </div>
          </div>
          <div className={styles.hooks}>
            {momentEntries.map(({ intent, ref }) => {
              const candidate = hookById.get(ref.candidate_id);
              const next: WindowSelection = candidate
                ? hookSelection(candidate)
                : { id: ref.candidate_id, label: ref.label, startMs: ref.start_ms, endMs: ref.end_ms, kind: "hook" };
              return (
                <article key={intent} className={selection?.id === ref.candidate_id ? styles.hookActive : styles.hook}>
                  <button type="button" className={styles.hookPlay} onClick={() => toggleSelection(next)}>
                    <span>{selection?.id === ref.candidate_id && playing ? "❚❚" : "▶"}</span>
                    <div>
                      <strong>{INTENT_LABELS[intent]}</strong>
                      <small>{ref.label} · {time(ref.start_ms)}–{time(ref.end_ms)}</small>
                    </div>
                  </button>
                  <div className={styles.score}><strong>{Math.round(ref.score * 100)}</strong><small>intent fit</small></div>
                </article>
              );
            })}
          </div>
        </>
      ) : null}

      <div className={styles.splitHeading}>
        <div>
          <span className="section-label">Ranked windows</span>
          <h3>Reusable musical candidates</h3>
          <p>Overall ranking combines semantic recurrence, structure, lift, rhythmic activity, harmonic identity, edit boundaries, loop fit and the candidate’s purpose-specific scores.</p>
        </div>
        {hooks[0] ? <span className={styles.primaryScore}>Best {Math.round(hooks[0].score * 100)}</span> : null}
      </div>

      {hooks.length ? (
        <div className={styles.hooks}>
          {hooks.map((hook, index) => {
            const active = selection?.id === hook.id;
            const socialDuration = socialCutIds.get(hook.id);
            const topIntents = Object.entries(hook.intent_scores ?? {})
              .filter((entry): entry is [MusicMomentIntent, number] => typeof entry[1] === "number")
              .sort((a, b) => b[1] - a[1])
              .slice(0, 2);
            return (
              <article key={hook.id} className={active ? styles.hookActive : styles.hook}>
                <button type="button" className={styles.hookPlay} onClick={() => toggleSelection(hookSelection(hook))}>
                  <span>{active && playing ? "❚❚" : "▶"}</span>
                  <div>
                    <strong>#{index + 1} {hook.label}</strong>
                    <small>{time(hook.start_ms)}–{time(hook.end_ms)} · {(hook.duration_ms / 1000).toFixed(1)}s</small>
                  </div>
                </button>
                <div className={styles.score}><strong>{Math.round(hook.score * 100)}</strong><small>overall fit</small></div>
                <div className={styles.hookBadges}>
                  <span>{hook.kind.replaceAll("_", " ")}</span>
                  {socialDuration ? <span>{socialDuration}s primary cut</span> : null}
                  <span>{hook.section_label}</span>
                  {topIntents.map(([intent, score]) => <span key={intent}>{INTENT_LABELS[intent]} {Math.round(score * 100)}</span>)}
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
          <strong>No scored windows in this map.</strong>
          <p>{map.source === "fallback" ? "Estimated maps intentionally do not invent hooks. Run real analysis to generate candidates." : "This is a legacy analysis. Re-run the track to upgrade it to Track Intelligence v3."}</p>
        </div>
      )}

      {selectedHook ? (
        <div className={styles.metricPanel}>
          <div>
            <span className="section-label">Why this window</span>
            <h3>{selectedHook.label}</h3>
          </div>
          <div className={styles.metrics}>
            {selectedMetrics.map(([key, metricValue]) => (
              <div key={key}>
                <span><small>{metricLabel(key)}</small><strong>{Math.round(metricValue * 100)}</strong></span>
                <i><b style={{ width: `${Math.max(0, Math.min(100, metricValue * 100))}%` }} /></i>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {map.social_cuts ? (
        <div className={styles.socialCuts}>
          <div><span className="section-label">Primary deliverables</span><h3>Social cuts</h3></div>
          {Object.entries(map.social_cuts).map(([duration, cut]) => (
            cut ? (
              <button
                type="button"
                key={duration}
                onClick={() => toggleSelection({
                  id: cut.candidate_id,
                  label: `${duration}s · ${cut.label}`,
                  startMs: cut.start_ms,
                  endMs: cut.end_ms,
                  kind: "hook",
                })}
              >
                <strong>{duration}s</strong>
                <span>{cut.label}</span>
                <small>{time(cut.start_ms)}–{time(cut.end_ms)} · {Math.round(cut.score * 100)} fit</small>
              </button>
            ) : null
          ))}
        </div>
      ) : null}

      {map.social_cut_options && Object.values(map.social_cut_options).some((items) => items.length > 1) ? (
        <details className={styles.diagnostics}>
          <summary>Alternate social cuts</summary>
          {Object.entries(map.social_cut_options).map(([duration, options]) => (
            options.length > 1 ? (
              <div key={duration} className={styles.reasons}>
                {options.slice(1).map((cut, index) => (
                  <button
                    type="button"
                    key={`${duration}-${cut.candidate_id}-${index}`}
                    onClick={() => toggleSelection({
                      id: cut.candidate_id,
                      label: `${duration}s alternate · ${cut.label}`,
                      startMs: cut.start_ms,
                      endMs: cut.end_ms,
                      kind: "hook",
                    })}
                  >
                    {duration}s alt #{index + 2} · {time(cut.start_ms)}–{time(cut.end_ms)} · {Math.round(cut.score * 100)} fit
                  </button>
                ))}
              </div>
            ) : null
          ))}
        </details>
      ) : null}

      {qc ? (
        <div className={styles.metricPanel}>
          <div>
            <span className="section-label">Master QC</span>
            <h3>{qc.technical_ready ? "No blocking master defect detected" : "Master needs technical review"}</h3>
          </div>
          <div className={styles.hookBadges}>
            {typeof qc.integrated_lufs === "number" ? <span>{qc.integrated_lufs.toFixed(1)} LUFS</span> : null}
            {typeof qc.true_peak_dbtp === "number" ? <span>{qc.true_peak_dbtp.toFixed(2)} dBTP est.</span> : null}
            {typeof qc.crest_factor_db === "number" ? <span>{qc.crest_factor_db.toFixed(1)} dB crest</span> : null}
            {typeof qc.stereo_correlation === "number" ? <span>Stereo corr. {qc.stereo_correlation.toFixed(2)}</span> : null}
            {typeof qc.clipping_samples === "number" ? <span>{qc.clipping_samples} clipped samples</span> : null}
          </div>
          {qc.issues.length ? (
            <div className={styles.reasons}>
              {qc.issues.map((issue) => <span key={`${issue.code}-${issue.message}`}>{issue.severity}: {issue.message}</span>)}
            </div>
          ) : null}
        </div>
      ) : null}

      {confidence ? (
        <div className={styles.metricPanel}>
          <div><span className="section-label">Analysis confidence</span><h3>{percentage(confidence.overall)} overall</h3></div>
          <div className={styles.metrics}>
            {Object.entries(confidence).filter(([key]) => key !== "overall").map(([key, metricValue]) => (
              <div key={key}>
                <span><small>{key}</small><strong>{Math.round(metricValue * 100)}</strong></span>
                <i><b style={{ width: `${metricValue * 100}%` }} /></i>
              </div>
            ))}
          </div>
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

      {map.source === "worker" && map.version < 3 && data.services.worker.configured ? (
        <form action={analyzeMusicVideoTrack} className={styles.inlineAction}>
          <input type="hidden" name="project_id" value={data.project.id} />
          <SubmitButton pendingLabel="Upgrading analysis...">Upgrade this track to v3</SubmitButton>
        </form>
      ) : null}

      {analyzing ? (
        <div className={styles.processing}>
          <span />
          <div><strong>Deep track analysis is running</strong><p>The request is durable. Atlas will refresh to the v3 production map when the queued worker completes.</p></div>
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
