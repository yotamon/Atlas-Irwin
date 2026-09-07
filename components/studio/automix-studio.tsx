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
      <section className={styles.heroCard}>
        <div>
          <span className="section-label">Professional DJ engine</span>
          <h2>Build the set, not a playlist crossfade</h2>
          <p>
            AutoMix reads phrasing, downbeats, local tempo, harmonic compatibility, vocal and bass activity,
            mastering quality and the real loudness of the audio windows it uses. Unstable BPM is never forced onto a grid.
          </p>
        </div>
        <div className={styles.qualityPills} aria-label="AutoMix quality protections">
          <span>Variable-tempo aware</span>
          <span>Vocal collision veto</span>
          <span>True-peak safe</span>
          <span>Master-preserving</span>
        </div>
      </section>

      <div className={styles.builderGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <span className="section-label">01 / Set intent</span>
              <h2>Tell the engine what this mix is for</h2>
            </div>
          </div>

          <label className="field">
            <span>Mix name</span>
            <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          </label>

          <div className={styles.intentGrid}>
            {PURPOSES.map((item) => (
              <button
                className={`${styles.intentCard} ${purpose === item.id ? styles.selectedIntent : ""}`}
                type="button"
                key={item.id}
                onClick={() => {
                  setPurpose(item.id);
                  if (item.id === "booking" && name.endsWith("Booking Mix") === false) setName(`${artistName} Booking Mix`);
                  if (item.id === "journey") setName(`${artistName} Artist Journey`);
                }}
              >
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </button>
            ))}
          </div>
          <p className={styles.intentNote}>{purposeCopy}</p>

          <div className="form-grid">
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
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <span className="section-label">02 / Source material</span>
              <h2>Choose the catalog</h2>
              <p>{selectedIds.length} selected · 2–20 tracks</p>
            </div>
          </div>

          <div className={styles.catalogList}>
            {available.map((track) => {
              const active = selectedIds.includes(track.id);
              return (
                <button
                  key={track.id}
                  type="button"
                  className={`${styles.catalogTrack} ${active ? styles.catalogTrackSelected : ""}`}
                  onClick={() => toggleTrack(track.id)}
                >
                  <span className={styles.check}>{active ? <FiCheck /> : <FiMusic />}</span>
                  <span>
                    <strong>{track.title}</strong>
                    <small>{track.is_primary ? "Primary master" : "Canonical master"}</small>
                  </span>
                </button>
              );
            })}
            {!available.length ? <p className={styles.empty}>Add at least two mastered tracks before creating a mix.</p> : null}
          </div>
        </section>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <span className="section-label">03 / Running order</span>
            <h2>{purpose === "journey" ? "Your order is the story" : "Starting order"}</h2>
            <p>{purpose === "journey" ? "Journey mode preserves this exact order." : "The DJ planner may reorder these tracks when a better harmonic and energy path exists."}</p>
          </div>
        </div>
        <div className={styles.runningOrder}>
          {selected.map((track, index) => (
            <div className={styles.orderRow} key={track.id}>
              <span className={styles.orderIndex}>{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{track.title}</strong><small>{purpose === "journey" ? "Locked narrative position" : "Eligible for intelligent sequencing"}</small></div>
              <div className={styles.orderActions}>
                <button type="button" aria-label={`Move ${track.title} up`} disabled={index === 0} onClick={() => moveTrack(index, -1)}><FiArrowUp /></button>
                <button type="button" aria-label={`Move ${track.title} down`} disabled={index === selected.length - 1} onClick={() => moveTrack(index, 1)}><FiArrowDown /></button>
              </div>
            </div>
          ))}
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}
        <div className={styles.createBar}>
          <div>
            <strong>{selectedIds.length >= 2 ? "Ready to plan the set" : "Choose at least two tracks"}</strong>
            <span>Offline high-quality render · pitch preserved · max ±6% fixed-grid stretch</span>
          </div>
          <button className="button primary" type="button" disabled={creating || selectedIds.length < 2} onClick={createMix}>
            <FiZap /> {creating ? "Starting…" : "Create professional mix"}
          </button>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <span className="section-label">04 / Mixes</span>
            <h2>Rendered sets</h2>
          </div>
          <button className="button" type="button" disabled={loadingJobs} onClick={() => void loadJobs()}><FiRefreshCw /> Refresh</button>
        </div>

        <div className={styles.jobs}>
          {jobs.map((job) => {
            const result = (job.result_payload && typeof job.result_payload === "object" && !Array.isArray(job.result_payload))
              ? job.result_payload as Record<string, unknown>
              : {};
            const render = (result.render && typeof result.render === "object" && !Array.isArray(result.render))
              ? result.render as Record<string, unknown>
              : {};
            const warnings = Array.isArray(result.warnings) ? result.warnings : [];
            return (
              <article className={styles.jobCard} key={job.id}>
                <div className={styles.jobTop}>
                  <div>
                    <small>{job.purpose.replaceAll("_", " ")} · {job.track_ids.length} tracks</small>
                    <strong>{job.name}</strong>
                  </div>
                  <span className={`${styles.status} ${styles[`status_${job.status}`] ?? ""}`}>{statusLabel(job.status)}</span>
                </div>

                {job.status === "completed" && job.output?.public_url ? (
                  <div className={styles.player}>
                    <audio controls preload="metadata" src={job.output.public_url} />
                    <div className={styles.resultMeta}>
                      <span>{formatDuration(job.output.duration_ms || Number(render.duration_ms) || 0)}</span>
                      {typeof render.final_measured_lufs === "number" ? <span>{render.final_measured_lufs.toFixed(1)} LUFS</span> : null}
                      <span>-1 dBTP ceiling</span>
                    </div>
                    <a className="button" href={job.output.public_url} target="_blank" rel="noreferrer"><FiDownload /> Open mix</a>
                  </div>
                ) : null}

                {ACTIVE.has(job.status) ? (
                  <div className={styles.progress}><span /><p>Analyzing the selected material, planning the set and rendering offline.</p></div>
                ) : null}

                {job.error ? <p className={styles.jobError}>{job.error}</p> : null}
                {warnings.length ? <details className={styles.warnings}>
                  <summary>{warnings.length} source note{warnings.length === 1 ? "" : "s"}</summary>
                  {warnings.map((warning, index) => {
                    const item = warning && typeof warning === "object" && !Array.isArray(warning) ? warning as Record<string, unknown> : {};
                    return <p key={index}>{typeof item.message === "string" ? item.message : "Source material required conservative handling."}</p>;
                  })}
                </details> : null}
              </article>
            );
          })}
          {!jobs.length && !loadingJobs ? <p className={styles.empty}>No mixes yet. Your first rendered set will appear here.</p> : null}
          {loadingJobs && !jobs.length ? <p className={styles.empty}>Loading mixes…</p> : null}
        </div>
      </section>
    </div>
  );
}
