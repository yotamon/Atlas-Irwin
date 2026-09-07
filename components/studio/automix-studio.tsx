"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FiArrowDown, FiArrowUp, FiCheck, FiDownload, FiMusic, FiRefreshCw, FiZap } from "react-icons/fi";
import type {
  AutoMixEnergyProfile,
  AutoMixJob,
  AutoMixOutputFormat,
  AutoMixPurpose,
  AutoMixTransitionStyle,
} from "@/types/automix-database";
import { ProcessingState } from "./processing-state";
import styles from "./automix-studio.module.css";

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

const PURPOSES: Array<{ id: AutoMixPurpose; label: string; description: string }> = [
  { id: "booking", label: "Booking mix", description: "Strong identity arc for promoters and bookings. Ensemblis may reorder tracks for the strongest set flow." },
  { id: "soundcloud", label: "SoundCloud mix", description: "Longer groove continuity with musical transitions that reward full-set listening." },
  { id: "journey", label: "Artist journey", description: "Preserves your chosen order and treats it as the narrative of the mix." },
  { id: "peak_time", label: "Peak time", description: "Higher-energy sequencing, tighter momentum and fewer long resets." },
  { id: "warm_up", label: "Warm-up", description: "Patient energy growth, more headroom and transitions that leave room for the room to develop." },
  { id: "discovery", label: "Discovery", description: "Gets to each track's strongest identity quickly without sounding like a medley." },
];

const ACTIVE = new Set(["planned", "queued", "running"]);

function formatDuration(ms: number | null | undefined) {
  if (!ms || ms <= 0) return "";
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
  if (value && typeof value === "object" && "error" in value && typeof value.error === "string") return value.error;
  return fallback;
}

function activeMixSteps(status: AutoMixJob["status"]) {
  const waiting = "waiting" as const;
  const active = "active" as const;
  const complete = "complete" as const;

  if (status === "running") {
    return [
      { label: "Queue", state: complete },
      { label: "DJ plan + render", state: active },
      { label: "Master verify", state: waiting },
    ];
  }

  return [
    { label: "Queue", state: active },
    { label: "DJ plan + render", state: waiting },
    { label: "Master verify", state: waiting },
  ];
}

export function AutoMixStudio({ artistId, artistName, tracks }: AutoMixStudioProps) {
  const available = useMemo(() => tracks.filter((track) => Boolean(track.audio_url)), [tracks]);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => available.slice(0, Math.min(8, available.length)).map((track) => track.id));
  const [name, setName] = useState(`${artistName} Booking Mix`);
  const [purpose, setPurpose] = useState<AutoMixPurpose>("booking");
  const [energyProfile, setEnergyProfile] = useState<AutoMixEnergyProfile>("dynamic");
  const [transitionStyle, setTransitionStyle] = useState<AutoMixTransitionStyle>("dj");
  const [outputFormat, setOutputFormat] = useState<AutoMixOutputFormat>("mp3");
  const [durationMinutes, setDurationMinutes] = useState(20);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [creating, setCreating] = useState(false);
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
    if (!response.ok) throw new Error(responseError(body, "Could not load AutoMix jobs."));
    return Array.isArray(body?.jobs) ? body.jobs : [];
  }, [artistId]);

  const loadJobs = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingJobs(true);
    try {
      setJobs(await fetchJobs());
    } catch (loadError) {
      if (!quiet) setError(loadError instanceof Error ? loadError.message : "Could not load AutoMix jobs.");
    } finally {
      if (!quiet) setLoadingJobs(false);
    }
  }, [fetchJobs]);

  useEffect(() => {
    let active = true;
    async function loadInitialJobs() {
      try {
        const nextJobs = await fetchJobs();
        if (active) setJobs(nextJobs);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load AutoMix jobs.");
      } finally {
        if (active) setLoadingJobs(false);
      }
    }
    void loadInitialJobs();
    return () => {
      active = false;
    };
  }, [fetchJobs]);

  useEffect(() => {
    if (!jobs.some((job) => ACTIVE.has(job.status))) return;
    const timer = window.setInterval(() => void loadJobs(true), 4000);
    return () => window.clearInterval(timer);
  }, [jobs, loadJobs]);

  function toggleTrack(trackId: string) {
    setSelectedIds((current) => {
      if (current.includes(trackId)) return current.filter((id) => id !== trackId);
      if (current.length >= 20) return current;
      return [...current, trackId];
    });
  }

  function moveTrack(index: number, direction: -1 | 1) {
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
            <li><span>03</span><strong>True-peak safe</strong></li>
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
                  if (item.id === "booking" && name.endsWith("Booking Mix") === false) setName(`${artistName} Booking Mix`);
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
            <label className="field">
              <span>Target length</span>
              <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>
                {[10, 15, 20, 30, 45, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
              </select>
            </label>
            <label className="field">
              <span>Energy arc</span>
              <select value={energyProfile} onChange={(event) => setEnergyProfile(event.target.value as AutoMixEnergyProfile)}>
                <option value="smooth">Smooth</option>
                <option value="dynamic">Dynamic</option>
                <option value="peak">Peak</option>
              </select>
            </label>
            <label className="field">
              <span>Transition character</span>
              <select value={transitionStyle} onChange={(event) => setTransitionStyle(event.target.value as AutoMixTransitionStyle)}>
                <option value="clean">Clean</option>
                <option value="dj">DJ</option>
                <option value="creative">Creative</option>
              </select>
            </label>
            <label className="field">
              <span>Output</span>
              <select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as AutoMixOutputFormat)}>
                <option value="mp3">320 kbps MP3</option>
                <option value="wav">24-bit WAV</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className={styles.stage}>
        <div className={styles.stageIntro}>
          <span className="section-label">02 / Source material</span>
          <h2>Choose the records.</h2>
          <p>{selectedIds.length} selected · 2–20 mastered tracks</p>
        </div>
        <div className={styles.stageBody}>
          <div className={styles.catalogList}>
            {available.map((track, index) => {
              const active = selectedIds.includes(track.id);
              return (
                <button
                  key={track.id}
                  type="button"
                  className={`${styles.catalogTrack} ${active ? styles.catalogTrackSelected : ""}`}
                  aria-pressed={active}
                  onClick={() => toggleTrack(track.id)}
                >
                  <span className={styles.catalogIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.check}>{active ? <FiCheck /> : <FiMusic />}</span>
                  <span className={styles.catalogCopy}>
                    <strong>{track.title}</strong>
                    <small>{track.is_primary ? "Primary master" : "Canonical master"}</small>
                  </span>
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
          <span className="section-label">03 / Running order</span>
          <h2>{purpose === "journey" ? "Your order is the story." : "Sketch the setlist."}</h2>
          <p>{purpose === "journey" ? "Journey mode preserves this exact order." : "The DJ planner may reorder tracks when a stronger harmonic and energy path exists."}</p>
        </div>
        <div className={styles.stageBody}>
          <div className={styles.runningOrder}>
            {selected.map((track, index) => (
              <div className={styles.orderRow} key={track.id}>
                <span className={styles.orderIndex}>{String(index + 1).padStart(2, "0")}</span>
                <div className={styles.orderCopy}>
                  <strong>{track.title}</strong>
                  <small>{purpose === "journey" ? "Locked narrative position" : "Eligible for intelligent sequencing"}</small>
                </div>
                <div className={styles.orderActions}>
                  <button type="button" aria-label={`Move ${track.title} up`} disabled={index === 0} onClick={() => moveTrack(index, -1)}><FiArrowUp /></button>
                  <button type="button" aria-label={`Move ${track.title} down`} disabled={index === selected.length - 1} onClick={() => moveTrack(index, 1)}><FiArrowDown /></button>
                </div>
              </div>
            ))}
          </div>

          {error ? <div className={styles.error} role="alert">{error}</div> : null}
          <div className={styles.createBar}>
            <div>
              <span className={styles.readiness}>{selectedIds.length >= 2 ? "SET READY" : "NEEDS MUSIC"}</span>
              <strong>{selectedIds.length >= 2 ? `${selectedIds.length} tracks ready for the planner` : "Choose at least two tracks"}</strong>
              <small>Offline high-quality render · pitch preserved · max ±6% fixed-grid stretch</small>
            </div>
            <button className="button primary" type="button" disabled={creating || selectedIds.length < 2} onClick={createMix}>
              <FiZap /> {creating ? "Starting engine…" : "Create professional mix"}
            </button>
          </div>
        </div>
      </section>

      <section className={`${styles.stage} ${styles.sessionsStage}`}>
        <div className={styles.stageIntro}>
          <span className="section-label">04 / Sessions</span>
          <h2>Rendered sets.</h2>
          <p>Each session keeps its purpose, source lineage, render state and final audio together.</p>
          <button className="button" type="button" disabled={loadingJobs} onClick={() => void loadJobs()}><FiRefreshCw /> Refresh sessions</button>
        </div>

        <div className={styles.stageBody}>
          <div className={styles.jobs}>
            {jobs.map((job, index) => {
              const result = (job.result_payload && typeof job.result_payload === "object" && !Array.isArray(job.result_payload))
                ? job.result_payload as Record<string, unknown>
                : {};
              const render = (result.render && typeof result.render === "object" && !Array.isArray(result.render))
                ? result.render as Record<string, unknown>
                : {};
              const warnings = Array.isArray(result.warnings) ? result.warnings : [];
              return (
                <article className={`${styles.job} ${ACTIVE.has(job.status) ? styles.activeJob : ""}`} key={job.id}>
                  <div className={styles.jobTop}>
                    <span className={styles.jobIndex}>{String(index + 1).padStart(2, "0")}</span>
                    <div className={styles.jobIdentity}>
                      <small>{job.purpose.replaceAll("_", " ")} · {job.track_ids.length} tracks</small>
                      <strong>{job.name}</strong>
                    </div>
                    <span className={`${styles.status} ${styles[`status_${job.status}`] ?? ""}`}>{statusLabel(job.status)}</span>
                  </div>

                  {job.status === "completed" && job.output?.public_url ? (
                    <div className={styles.player}>
                      <audio controls preload="metadata" src={job.output.public_url} />
                      <div className={styles.resultMeta}>
                        <span><small>Length</small>{formatDuration(job.output.duration_ms || Number(render.duration_ms) || 0)}</span>
                        {typeof render.final_measured_lufs === "number" ? <span><small>Loudness</small>{render.final_measured_lufs.toFixed(1)} LUFS</span> : null}
                        <span><small>Ceiling</small>-1 dBTP</span>
                      </div>
                      <a className="button" href={job.output.public_url} target="_blank" rel="noreferrer"><FiDownload /> Open mix</a>
                    </div>
                  ) : null}

                  {ACTIVE.has(job.status) ? (
                    <ProcessingState
                      className={styles.jobProcessing}
                      compact
                      eyebrow="AutoMix session"
                      title={job.status === "running" ? "The DJ engine is building the set" : "The set is entering the render queue"}
                      detail="Phrasing, tempo behavior, transition safety and final mastering evidence stay attached to this session."
                      steps={activeMixSteps(job.status)}
                    />
                  ) : null}

                  {job.error ? <p className={styles.jobError}>{job.error}</p> : null}
                  {warnings.length ? <details className={styles.warnings}>
                    <summary>{warnings.length} source note{warnings.length === 1 ? "" : "s"}</summary>
                    {warnings.map((warning, warningIndex) => {
                      const item = warning && typeof warning === "object" && !Array.isArray(warning) ? warning as Record<string, unknown> : {};
                      return <p key={warningIndex}>{typeof item.message === "string" ? item.message : "Source material required conservative handling."}</p>;
                    })}
                  </details> : null}
                </article>
              );
            })}
            {!jobs.length && !loadingJobs ? <p className={styles.empty}>No sessions yet. Your first rendered set will appear here.</p> : null}
            {loadingJobs && !jobs.length ? (
              <ProcessingState
                className={styles.sessionsLoading}
                compact
                eyebrow="Session archive"
                title="Reading the mix room"
                detail="Loading the artist's AutoMix sessions and render states."
                steps={[{ label: "Sessions", state: "active" }]}
              />
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
