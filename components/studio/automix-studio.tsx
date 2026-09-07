"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiCheck,
  FiDownload,
  FiGripVertical,
  FiMusic,
  FiRefreshCw,
  FiX,
  FiZap,
} from "react-icons/fi";
import type {
  AutoMixEnergyProfile,
  AutoMixJob,
  AutoMixOutputFormat,
  AutoMixPurpose,
  AutoMixTransitionStyle,
} from "@/types/automix-database";
import { ProcessingState } from "./processing-state";
import styles from "./automix-studio-v2.module.css";

type TrackOption = {
  id: string;
  title: string;
  release_id: string | null;
  audio_url: string | null;
  is_primary: boolean;
};

type OutputAsset = {
  id: string;
  public_url: string;
  mime_type: string | null;
  duration_ms: number | null;
};

type JobView = AutoMixJob & { output?: OutputAsset | null };

type AutoMixStudioProps = {
  artistId: string;
  artistName: string;
  tracks: TrackOption[];
};

type PlanTrack = {
  track_id?: string;
  title?: string;
  playback_bpm?: number;
  source_bpm?: number;
  energy?: number;
  key?: { label?: string; camelot?: string; confidence?: number };
  tempo?: { classification?: string; reliability?: number };
};

type PlanTransition = {
  from_track_id?: string;
  to_track_id?: string;
  technique?: string;
  bars?: number;
  beatmatch?: boolean;
  score?: number;
  reasons?: string[];
  metrics?: {
    stretch_delta?: number;
    harmonic?: number;
    vocal_collision?: number;
    bass_collision?: number;
  };
};

type AutoMixPlan = {
  estimated_duration_ms?: number;
  tracks?: PlanTrack[];
  transitions?: PlanTransition[];
  quality_contract?: Record<string, unknown>;
};

const PURPOSES: Array<{ id: AutoMixPurpose; label: string; description: string }> = [
  { id: "booking", label: "Booking mix", description: "Strong identity arc for promoters and bookings. Ensemblis may reorder tracks for the strongest set flow." },
  { id: "soundcloud", label: "SoundCloud mix", description: "Longer groove continuity with musical transitions that reward full-set listening." },
  { id: "journey", label: "Artist journey", description: "Preserves your chosen order and treats it as the narrative of the mix." },
  { id: "peak_time", label: "Peak time", description: "Higher-energy sequencing, tighter momentum and fewer long resets." },
  { id: "warm_up", label: "Warm-up", description: "Patient energy growth, more headroom and transitions that leave room for the room to develop." },
  { id: "discovery", label: "Discovery", description: "Gets to each track's strongest identity quickly without sounding like a medley." },
];

const ACTIVE = new Set<AutoMixJob["status"]>(["planned", "queued", "running"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function formatDuration(ms: number | null | undefined) {
  if (!ms || ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function statusLabel(status: AutoMixJob["status"]) {
  return {
    planned: "Planned",
    queued: "Queued",
    running: "Mixing",
    completed: "Ready",
    failed: "Failed",
    cancelled: "Cancelled",
  }[status];
}

function responseError(value: unknown, fallback: string) {
  const body = asRecord(value);
  return typeof body.error === "string" ? body.error : fallback;
}

function resultPayload(job: JobView) {
  return asRecord(job.result_payload);
}

function planFromJob(job: JobView): AutoMixPlan | null {
  const plan = resultPayload(job).plan;
  return plan && typeof plan === "object" && !Array.isArray(plan) ? plan as AutoMixPlan : null;
}

function renderFromJob(job: JobView) {
  return asRecord(resultPayload(job).render);
}

function phaseFromJob(job: JobView) {
  const value = resultPayload(job).phase;
  return typeof value === "string" ? value : "";
}

function activeMixSteps(job: JobView) {
  const phase = phaseFromJob(job);
  if (phase === "rendering") {
    return [
      { label: "Source analysis", state: "complete" as const },
      { label: "DJ plan", state: "complete" as const },
      { label: "Render + master verification", state: "active" as const },
    ];
  }
  if (job.status === "running") {
    return [
      { label: "Source analysis", state: "active" as const },
      { label: "DJ plan", state: "waiting" as const },
      { label: "Render + master verification", state: "waiting" as const },
    ];
  }
  return [
    { label: "Render queue", state: "active" as const },
    { label: "Source analysis + DJ plan", state: "waiting" as const },
    { label: "Render + master verification", state: "waiting" as const },
  ];
}

function techniqueLabel(value?: string) {
  if (!value) return "Transition";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function percent(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

function AutoMixPlanView({ plan }: { plan: AutoMixPlan }) {
  const tracks = Array.isArray(plan.tracks) ? plan.tracks : [];
  const transitions = Array.isArray(plan.transitions) ? plan.transitions : [];
  if (!tracks.length) return null;

  return (
    <section className={styles.plan} aria-label="Verified DJ plan">
      <div className={styles.planHeading}>
        <div>
          <span className="section-label">Verified DJ plan</span>
          <h3>The engine has committed to this route.</h3>
        </div>
        <span>{formatDuration(plan.estimated_duration_ms)}</span>
      </div>

      <ol className={styles.planTracks}>
        {tracks.map((track, index) => {
          const transition = index < transitions.length ? transitions[index] : null;
          return (
            <li key={track.track_id ?? `${track.title}-${index}`}>
              <div className={styles.planTrack}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{track.title || "Untitled track"}</strong>
                  <small>
                    {typeof track.playback_bpm === "number" ? `${track.playback_bpm.toFixed(1)} BPM` : "Tempo preserved"}
                    {track.key?.camelot ? ` · ${track.key.camelot}` : track.key?.label ? ` · ${track.key.label}` : ""}
                    {track.tempo?.classification ? ` · ${track.tempo.classification.replaceAll("_", " ")}` : ""}
                  </small>
                </div>
                <span className={styles.planEnergy}>{typeof track.energy === "number" ? `Energy ${Math.round(track.energy * 100)}` : ""}</span>
              </div>
              {transition ? (
                <div className={styles.transition}>
                  <div className={styles.transitionTitle}>
                    <strong>{techniqueLabel(transition.technique)}</strong>
                    <span>{transition.beatmatch ? `${transition.bars ?? 0} bars · beatmatched` : "phrase-safe handoff"}</span>
                  </div>
                  <div className={styles.transitionMetrics}>
                    <span>Fit <b>{percent(transition.score)}</b></span>
                    <span>Harmonic <b>{percent(transition.metrics?.harmonic)}</b></span>
                    <span>Stretch <b>{typeof transition.metrics?.stretch_delta === "number" ? `${(transition.metrics.stretch_delta * 100).toFixed(1)}%` : "—"}</b></span>
                    <span>Vocal collision <b>{percent(transition.metrics?.vocal_collision)}</b></span>
                  </div>
                  {transition.reasons?.length ? <p>{transition.reasons.join(" · ")}</p> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function AutoMixStudio({ artistId, artistName, tracks }: AutoMixStudioProps) {
  const available = useMemo(() => tracks.filter((track) => Boolean(track.audio_url)), [tracks]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [name, setName] = useState(`${artistName} Booking Mix`);
  const [purpose, setPurpose] = useState<AutoMixPurpose>("booking");
  const [energyProfile, setEnergyProfile] = useState<AutoMixEnergyProfile>("dynamic");
  const [transitionStyle, setTransitionStyle] = useState<AutoMixTransitionStyle>("dj");
  const [outputFormat, setOutputFormat] = useState<AutoMixOutputFormat>("mp3");
  const [durationMinutes, setDurationMinutes] = useState(20);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [creating, setCreating] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const trackById = useMemo(() => new Map(available.map((track) => [track.id, track])), [available]);
  const selected = selectedIds.flatMap((id) => {
    const track = trackById.get(id);
    return track ? [track] : [];
  });
  const purposeCopy = PURPOSES.find((item) => item.id === purpose)?.description ?? "";

  const fetchJobs = useCallback(async (): Promise<JobView[]> => {
    const response = await fetch(`/api/studio/automix?artist=${encodeURIComponent(artistId)}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(responseError(body, "Could not load AutoMix sessions."));
    const bodyRecord = asRecord(body);
    return Array.isArray(bodyRecord.jobs) ? bodyRecord.jobs as JobView[] : [];
  }, [artistId]);

  const loadJobs = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingJobs(true);
    try {
      setJobs(await fetchJobs());
      if (!quiet) setError("");
    } catch (loadError) {
      if (!quiet) setError(loadError instanceof Error ? loadError.message : "Could not load AutoMix sessions.");
    } finally {
      if (!quiet) setLoadingJobs(false);
    }
  }, [fetchJobs]);

  useEffect(() => {
    let active = true;
    void fetchJobs()
      .then((nextJobs) => { if (active) setJobs(nextJobs); })
      .catch(() => { if (active) setError("Could not load AutoMix sessions. Retry when you're ready."); })
      .finally(() => { if (active) setLoadingJobs(false); });
    return () => { active = false; };
  }, [fetchJobs]);

  useEffect(() => {
    if (!jobs.some((job) => ACTIVE.has(job.status))) return;
    const timer = window.setInterval(() => void loadJobs(true), 3000);
    return () => window.clearInterval(timer);
  }, [jobs, loadJobs]);

  function toggleTrack(trackId: string) {
    setSelectedIds((current) => {
      if (current.includes(trackId)) {
        setError("");
        return current.filter((id) => id !== trackId);
      }
      if (current.length >= 20) {
        setError("AutoMix supports up to 20 tracks per session. Remove one before adding another.");
        return current;
      }
      setError("");
      return [...current, trackId];
    });
  }

  function moveTrack(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    setSelectedIds((current) => {
      const sourceIndex = current.indexOf(sourceId);
      const targetIndex = current.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function nudgeTrack(index: number, direction: -1 | 1) {
    setSelectedIds((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function createMix() {
    if (creating) return;
    if (selectedIds.length < 2) {
      setError("Choose at least two mastered tracks.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/studio/automix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artistId,
          trackIds: selectedIds,
          name: name.trim() || `${artistName} AutoMix`,
          purpose,
          energyProfile,
          transitionStyle,
          outputFormat,
          durationMs: durationMinutes * 60 * 1000,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(body, "Could not start AutoMix."));
      await loadJobs(true);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not start AutoMix.");
    } finally {
      setCreating(false);
    }
  }

  async function cancelMix(jobId: string) {
    if (cancellingId) return;
    setCancellingId(jobId);
    try {
      const response = await fetch("/api/studio/automix", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artistId, jobId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(body, "Could not cancel this session."));
      await loadJobs(true);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Could not cancel this session.");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className="section-label">Professional DJ engine / artist catalog only</span>
          <h2>Build the set,<br />not a crossfade.</h2>
          <p>
            AutoMix reads phrasing, downbeats, local tempo, harmonic compatibility, vocal and bass activity,
            mastering quality and the real loudness of the audio windows it uses. Unstable BPM is never forced onto a grid.
          </p>
        </div>
        <div className={styles.technicalRider} aria-label="AutoMix quality protections">
          <span className={styles.riderLabel}>Technical rider</span>
          <ol>
            <li><span>01</span><strong>Variable-tempo aware</strong></li>
            <li><span>02</span><strong>Vocal collision veto</strong></li>
            <li><span>03</span><strong>Measured true-peak guard</strong></li>
            <li><span>04</span><strong>Master-preserving</strong></li>
          </ol>
        </div>
      </section>

      <section className={styles.stage}>
        <div className={styles.stageIntro}>
          <span className="section-label">01 / Set intent</span>
          <h2>What room is this set for?</h2>
          <p>{purposeCopy}</p>
        </div>
        <div className={styles.stageBody}>
          <label className="field">
            <span>Mix name</span>
            <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className={styles.intentList}>
            {PURPOSES.map((item, index) => (
              <button
                className={`${styles.intentChoice} ${purpose === item.id ? styles.selectedIntent : ""}`}
                type="button"
                key={item.id}
                aria-pressed={purpose === item.id}
                onClick={() => {
                  setPurpose(item.id);
                  if (item.id === "booking") setName(`${artistName} Booking Mix`);
                  if (item.id === "journey") setName(`${artistName} Artist Journey`);
                }}
              >
                <span className={styles.intentIndex}>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.label}</strong>
                <span className={styles.intentDescription}>{item.description}</span>
                <span className={styles.intentMark} aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className={styles.controlStrip}>
            <label className="field"><span>Target length</span><select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>{[10, 15, 20, 30, 45, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label>
            <label className="field"><span>Energy arc</span><select value={energyProfile} onChange={(event) => setEnergyProfile(event.target.value as AutoMixEnergyProfile)}><option value="smooth">Smooth</option><option value="dynamic">Dynamic</option><option value="peak">Peak</option></select></label>
            <label className="field"><span>Transition character</span><select value={transitionStyle} onChange={(event) => setTransitionStyle(event.target.value as AutoMixTransitionStyle)}><option value="clean">Clean</option><option value="dj">DJ</option><option value="creative">Creative</option></select></label>
            <label className="field"><span>Output</span><select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as AutoMixOutputFormat)}><option value="mp3">320 kbps MP3</option><option value="wav">24-bit WAV</option></select></label>
          </div>
        </div>
      </section>

      <section className={styles.stage}>
        <div className={styles.stageIntro}>
          <span className="section-label">02 / Source material</span>
          <h2>Choose the records.</h2>
          <p>{selectedIds.length} selected · choose 2–20 mastered tracks yourself</p>
        </div>
        <div className={styles.stageBody}>
          <div className={styles.catalogList}>
            {available.map((track, index) => {
              const active = selectedIds.includes(track.id);
              return (
                <button key={track.id} type="button" className={`${styles.catalogTrack} ${active ? styles.catalogTrackSelected : ""}`} aria-pressed={active} onClick={() => toggleTrack(track.id)}>
                  <span className={styles.catalogIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.check}>{active ? <FiCheck /> : <FiMusic />}</span>
                  <span className={styles.catalogCopy}><strong>{track.title}</strong><small>{track.is_primary ? "Primary master" : "Canonical master"}</small></span>
                  <span className={styles.catalogState}>{active ? "In set" : "Add"}</span>
                </button>
              );
            })}
            {!available.length ? <p className={styles.empty}>Add at least two mastered tracks before creating a mix.</p> : null}
          </div>
        </div>
      </section>

      <section className={`${styles.stage} ${styles.runningStage}`}>
        <div className={styles.stageIntro}>
          <span className="section-label">03 / Seed order</span>
          <h2>{purpose === "journey" ? "Your order is the story." : "Give the planner a starting point."}</h2>
          <p>{purpose === "journey" ? "Journey mode preserves this exact order." : "Drag the tracks into a useful seed order. The verified engine plan may reorder them only after it has analyzed the actual masters."}</p>
        </div>
        <div className={styles.stageBody}>
          <div className={styles.runningOrder}>
            {selected.map((track, index) => (
              <div
                className={`${styles.orderRow} ${draggedId === track.id ? styles.dragging : ""}`}
                key={track.id}
                draggable
                onDragStart={(event) => { setDraggedId(track.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", track.id); }}
                onDragEnd={() => setDraggedId(null)}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
                onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData("text/plain") || draggedId; if (sourceId) moveTrack(sourceId, track.id); setDraggedId(null); }}
              >
                <span className={styles.grip} aria-hidden><FiGripVertical /></span>
                <span className={styles.orderIndex}>{String(index + 1).padStart(2, "0")}</span>
                <div className={styles.orderCopy}><strong>{track.title}</strong><small>{purpose === "journey" ? "Locked narrative position" : "Seed position · planner can improve it after analysis"}</small></div>
                <div className={styles.orderActions}>
                  <button type="button" aria-label={`Move ${track.title} up`} disabled={index === 0} onClick={() => nudgeTrack(index, -1)}>↑</button>
                  <button type="button" aria-label={`Move ${track.title} down`} disabled={index === selected.length - 1} onClick={() => nudgeTrack(index, 1)}>↓</button>
                  <button type="button" aria-label={`Remove ${track.title} from set`} onClick={() => toggleTrack(track.id)}><FiX /></button>
                </div>
              </div>
            ))}
            {!selected.length ? <p className={styles.empty}>Nothing is selected yet. Choose the records you want in this mix.</p> : null}
          </div>

          <div className={styles.preflight}>
            <strong>What happens after you start</strong>
            <p>Ensemblis analyzes the selected masters, builds the real DJ plan, publishes that verified order and transition reasoning into the session, then renders and measures the final master. No plan is presented as “verified” before the engine has actually calculated it.</p>
          </div>

          {error ? <div className={styles.error} role="alert">{error}</div> : null}
          <div className={styles.createBar}>
            <div>
              <span className={styles.readiness}>{selectedIds.length >= 2 ? "READY FOR ANALYSIS" : "NEEDS MUSIC"}</span>
              <strong>{selectedIds.length >= 2 ? `${selectedIds.length} tracks selected by you` : "Choose at least two tracks"}</strong>
              <small>Pitch preserved · fixed-grid stretch capped by the engine's quality contract · final ceiling reported from the measured render</small>
            </div>
            <button className="button primary" type="button" disabled={creating || selectedIds.length < 2} onClick={createMix}><FiZap /> {creating ? "Starting engine…" : "Analyze, plan & render"}</button>
          </div>
        </div>
      </section>

      <section className={`${styles.stage} ${styles.sessionsStage}`}>
        <div className={styles.stageIntro}>
          <span className="section-label">04 / Sessions</span>
          <h2>Mix room.</h2>
          <p>Each session keeps source lineage, the verified DJ plan, render state and measured final audio together.</p>
          <button className="button" type="button" disabled={loadingJobs} onClick={() => void loadJobs()}><FiRefreshCw /> Refresh sessions</button>
        </div>

        <div className={styles.stageBody}>
          <div className={styles.jobs}>
            {jobs.map((job, index) => {
              const result = resultPayload(job);
              const render = renderFromJob(job);
              const plan = planFromJob(job);
              const warnings = Array.isArray(result.warnings) ? result.warnings : [];
              const ceiling = typeof render.ceiling_dbtp === "number" ? render.ceiling_dbtp : null;
              return (
                <article className={`${styles.job} ${ACTIVE.has(job.status) ? styles.activeJob : ""}`} key={job.id}>
                  <div className={styles.jobTop}>
                    <span className={styles.jobIndex}>{String(index + 1).padStart(2, "0")}</span>
                    <div className={styles.jobIdentity}><small>{job.purpose.replaceAll("_", " ")} · {job.track_ids.length} tracks</small><strong>{job.name}</strong></div>
                    <span className={`${styles.status} ${styles[`status_${job.status}`] ?? ""}`}>{statusLabel(job.status)}</span>
                  </div>

                  {ACTIVE.has(job.status) ? (
                    <div className={styles.activeSession}>
                      <ProcessingState
                        className={styles.jobProcessing}
                        compact
                        eyebrow="AutoMix session"
                        title={phaseFromJob(job) === "rendering" ? "The verified DJ plan is rendering" : job.status === "running" ? "Reading the masters and planning the set" : "The session is entering the worker queue"}
                        detail={phaseFromJob(job) === "rendering" ? "The plan below is real engine output. Rendering and final master verification are still in progress." : "No transition plan is claimed until source analysis and planning have actually completed."}
                        steps={activeMixSteps(job)}
                      />
                      <button className="button danger-text" type="button" disabled={cancellingId === job.id} onClick={() => void cancelMix(job.id)}>{cancellingId === job.id ? "Cancelling…" : "Cancel session"}</button>
                    </div>
                  ) : null}

                  {plan ? <AutoMixPlanView plan={plan} /> : null}

                  {job.status === "completed" && job.output?.public_url ? (
                    <div className={styles.player}>
                      <audio controls preload="metadata" src={job.output.public_url} />
                      <div className={styles.resultMeta}>
                        <span><small>Length</small>{formatDuration(job.output.duration_ms || (typeof render.duration_ms === "number" ? render.duration_ms : 0))}</span>
                        {typeof render.final_measured_lufs === "number" ? <span><small>Measured loudness</small>{render.final_measured_lufs.toFixed(1)} LUFS</span> : null}
                        {ceiling !== null ? <span><small>Measured ceiling</small>{ceiling.toFixed(1)} dBTP</span> : null}
                      </div>
                      <a className="button" href={job.output.public_url} download><FiDownload /> Download mix</a>
                    </div>
                  ) : null}

                  {job.error ? <p className={styles.jobError}>{job.error}</p> : null}
                  {warnings.length ? <details className={styles.warnings}>
                    <summary>{warnings.length} source note{warnings.length === 1 ? "" : "s"}</summary>
                    {warnings.map((warning, warningIndex) => {
                      const item = asRecord(warning);
                      return <p key={warningIndex}>{typeof item.message === "string" ? item.message : "Source material required conservative handling."}</p>;
                    })}
                  </details> : null}
                </article>
              );
            })}
            {!jobs.length && !loadingJobs ? <p className={styles.empty}>No sessions yet. Your first rendered set will appear here.</p> : null}
            {loadingJobs && !jobs.length ? <ProcessingState className={styles.sessionsLoading} compact eyebrow="Session archive" title="Reading the mix room" detail="Loading this artist's AutoMix sessions and render states." steps={[{ label: "Sessions", state: "active" }]} /> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
