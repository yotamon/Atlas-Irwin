"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiArrowDown,
  FiArrowUp,
  FiCheck,
  FiCpu,
  FiGitBranch,
  FiHardDrive,
  FiLock,
  FiPlay,
  FiRefreshCw,
  FiShuffle,
  FiUnlock,
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
import styles from "./local-set-builder-workspace.module.css";

type LibraryTrack = {
  id: string;
  deviceId: string;
  sourceId: string;
  sourceKind: string;
  sourceTrackId: string;
  recordingFingerprint: string;
  metadata: {
    title?: string;
    artist?: string | null;
    durationMs?: number | null;
    bpm?: number | null;
    musicalKey?: string | null;
  };
  planningEvidence?: {
    descriptor?: {
      energy?: number;
      key?: { camelot?: string; label?: string };
    };
  } | null;
  planningReady: boolean;
  planningReadiness?: { reasons?: string[] };
};

type PlanTrack = {
  track_id?: string;
  title?: string;
  playback_bpm?: number;
  source_bpm?: number;
  energy?: number;
  key?: { camelot?: string; label?: string };
  selection_reasons?: string[];
};

type PlanTransition = {
  from_track_id?: string;
  to_track_id?: string;
  technique?: string;
  bars?: number;
  beatmatch?: boolean;
  score?: number;
  confidence?: number;
  risk_flags?: string[];
  metrics?: { harmonic?: number; stretch_delta?: number; vocal_collision?: number; bass_collision?: number };
};

type Plan = {
  tracks?: PlanTrack[];
  transitions?: PlanTransition[];
  estimated_duration_ms?: number;
  plan_variant?: "safe" | "recommended" | "adventurous";
  quality_summary?: { mean_confidence?: number; risky_transition_count?: number };
  selection_summary?: { candidate_count?: number; selected_count?: number; omitted_count?: number };
  set_intent?: Record<string, unknown>;
  plan_directives?: Record<string, unknown>;
  render_manifest?: { plan_hash?: string };
};

type CandidateSnapshot = {
  candidates?: Array<{ candidateId?: string; libraryTrackId?: string; deviceId?: string }>;
};

type JobView = AutoMixJob;
type Variant = "safe" | "recommended" | "adventurous";

const ACTIVE = new Set<AutoMixJob["status"]>(["planned", "queued", "running"]);
const VARIANTS: Array<{ id: Variant; label: string; note: string }> = [
  { id: "safe", label: "Safe", note: "Maximum structural confidence" },
  { id: "recommended", label: "Recommended", note: "Balanced musical route" },
  { id: "adventurous", label: "Adventurous", note: "Bolder legal choices" },
];
const PURPOSES: Array<{ id: AutoMixPurpose; label: string }> = [
  { id: "booking", label: "Booking mix" },
  { id: "soundcloud", label: "SoundCloud" },
  { id: "journey", label: "Artist journey" },
  { id: "peak_time", label: "Peak time" },
  { id: "warm_up", label: "Warm-up" },
  { id: "discovery", label: "Discovery" },
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function executionTarget(job: JobView) {
  return record(job.request_payload).execution_target;
}

function executionMode(job: JobView) {
  const value = record(job.request_payload).execution_mode;
  return typeof value === "string" ? value : "render";
}

function planFromJob(job: JobView | null | undefined): Plan | null {
  if (!job) return null;
  const plan = record(job.result_payload).plan;
  return plan && typeof plan === "object" && !Array.isArray(plan) ? plan as Plan : null;
}

function snapshotFromJob(job: JobView | null | undefined): CandidateSnapshot {
  return record(record(job?.request_payload).candidate_snapshot) as CandidateSnapshot;
}

function lineage(job: JobView | null | undefined) {
  return record(record(job?.request_payload).plan_lineage);
}

function planHash(plan: Plan | null) {
  return typeof plan?.render_manifest?.plan_hash === "string" ? plan.render_manifest.plan_hash : "";
}

function percent(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

function duration(value: unknown) {
  if (typeof value !== "number" || value <= 0) return "—";
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function technique(value: string | undefined) {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Transition";
}

function status(value: AutoMixJob["status"]) {
  return ({ planned: "Waiting", queued: "Queued", running: "Working", completed: "Ready", failed: "Failed", cancelled: "Cancelled" })[value];
}

function candidateId(libraryTrackId: string) {
  return `dj-library:${libraryTrackId}`;
}

function responseError(body: unknown, fallback: string) {
  const value = record(body).error;
  return typeof value === "string" ? value : fallback;
}

export function LocalSetBuilderWorkspace({ artistId, artistName }: { artistId: string; artistName: string }) {
  const [library, setLibrary] = useState<LibraryTrack[]>([]);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [currentJobId, setCurrentJobId] = useState("");
  const [name, setName] = useState(`${artistName} Local Set Plan`);
  const [purpose, setPurpose] = useState<AutoMixPurpose>("booking");
  const [energy, setEnergy] = useState<AutoMixEnergyProfile>("dynamic");
  const [style, setStyle] = useState<AutoMixTransitionStyle>("dj");
  const [format, setFormat] = useState<AutoMixOutputFormat>("mp3");
  const [minutes, setMinutes] = useState(30);
  const [variant, setVariant] = useState<Variant>("recommended");
  const [allowOmissions, setAllowOmissions] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const [draftIdentity, setDraftIdentity] = useState("");
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);

  const load = useCallback(async (quiet = false) => {
    try {
      const [trackResponse, jobResponse] = await Promise.all([
        fetch(`/api/studio/dj-library/tracks?artistId=${encodeURIComponent(artistId)}&limit=200`, { cache: "no-store" }),
        fetch(`/api/studio/automix?artist=${encodeURIComponent(artistId)}`, { cache: "no-store" }),
      ]);
      const [trackBody, jobBody] = await Promise.all([
        trackResponse.json().catch(() => null),
        jobResponse.json().catch(() => null),
      ]);
      if (!trackResponse.ok) throw new Error(responseError(trackBody, "Could not load local-library tracks."));
      if (!jobResponse.ok) throw new Error(responseError(jobBody, "Could not load local Set Builder revisions."));
      const tracks = Array.isArray(record(trackBody).tracks) ? record(trackBody).tracks as LibraryTrack[] : [];
      const allJobs = Array.isArray(record(jobBody).jobs) ? record(jobBody).jobs as JobView[] : [];
      setLibrary(tracks);
      setJobs(allJobs.filter((job) => executionTarget(job) === "device"));
    } catch (loadError) {
      if (!quiet) setError(loadError instanceof Error ? loadError.message : "Could not load the local Set Builder.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [artistId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const active = jobs.some((job) => ACTIVE.has(job.status));
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void load(true), 2500);
    return () => window.clearInterval(timer);
  }, [active, load]);

  const readyTracks = useMemo(() => library.filter((track) => track.planningReady), [library]);
  const selectedDevice = readyTracks.find((track) => selected.includes(track.id))?.deviceId ?? "";
  const planJobs = useMemo(() => jobs.filter((job) => executionMode(job) === "plan_only"), [jobs]);
  const renderJobs = useMemo(() => jobs.filter((job) => executionMode(job) === "approved_render"), [jobs]);
  const currentJob = planJobs.find((job) => job.id === currentJobId)
    ?? planJobs.find((job) => job.status === "completed")
    ?? planJobs[0]
    ?? null;
  const currentPlan = planFromJob(currentJob);
  const currentTracks = currentPlan?.tracks ?? [];
  const currentTransitions = currentPlan?.transitions ?? [];
  const currentOrder = currentTracks.map((track) => String(track.track_id ?? "")).filter(Boolean);
  const identity = `${currentJob?.id ?? ""}:${planHash(currentPlan)}`;
  const directives = record(currentPlan?.plan_directives);
  const canonicalLocks = new Set(records(directives.locked_positions).map((item) => String(item.track_id ?? "")).filter(Boolean));
  const effectiveOrder = draftIdentity === identity ? draftOrder : currentOrder;
  const effectiveLocks = draftIdentity === identity ? locks : canonicalLocks;
  const dirty = effectiveOrder.join("|") !== currentOrder.join("|")
    || [...effectiveLocks].sort().join("|") !== [...canonicalLocks].sort().join("|");
  const snapshot = snapshotFromJob(currentJob);
  const snapshotLibraryIds = (snapshot.candidates ?? []).map((item) => item.libraryTrackId).filter((id): id is string => Boolean(id));
  const snapshotByCandidate = new Map((snapshot.candidates ?? []).flatMap((item) => item.candidateId && item.libraryTrackId ? [[item.candidateId, item.libraryTrackId] as const] : []));
  const planDeviceId = snapshot.candidates?.[0]?.deviceId ?? "";
  const replacements = readyTracks.filter((track) => track.deviceId === planDeviceId && !snapshotLibraryIds.includes(track.id));
  const latestRender = renderJobs[0] ?? null;
  const canEdit = Boolean(currentJob?.status === "completed" && currentPlan && currentOrder.length >= 2);

  function selectTrack(track: LibraryTrack) {
    if (!track.planningReady) return;
    setSelected((value) => {
      if (value.includes(track.id)) return value.filter((id) => id !== track.id);
      const existingDevice = readyTracks.find((item) => value.includes(item.id))?.deviceId;
      if (existingDevice && existingDevice !== track.deviceId) return [track.id];
      return value.length < 20 ? [...value, track.id] : value;
    });
  }

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/studio/automix/device-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artistId, ...body }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(responseError(payload, "Local Set Builder could not complete this operation."));
    return record(payload);
  }

  async function createPlan() {
    if (selected.length < 2) return;
    setBusy("create"); setError("");
    try {
      const ids = selected.map(candidateId);
      const payload = await post({
        action: "create",
        candidateRefs: selected.map((libraryTrackId) => ({ kind: "dj_library", libraryTrackId })),
        name,
        purpose,
        energyProfile: energy,
        transitionStyle: style,
        outputFormat: format,
        durationMs: minutes * 60_000,
        variant,
        setIntent: { allowOmissions: purpose === "journey" ? false : allowOmissions },
        planDirectives: {
          variant,
          preferredOrderTrackIds: ids,
          lockedPositions: purpose === "journey" ? ids.map((trackId, position) => ({ trackId, position })) : [],
          transitionOverrides: [],
        },
      });
      const id = record(payload.job).id;
      if (typeof id === "string") setCurrentJobId(id);
      await load(true);
    } catch (value) { setError(value instanceof Error ? value.message : "Could not create the local Set Plan."); }
    finally { setBusy(""); }
  }

  function startDraft(order = effectiveOrder, nextLocks = effectiveLocks) {
    setDraftIdentity(identity);
    setDraftOrder([...order]);
    setLocks(new Set(nextLocks));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= effectiveOrder.length) return;
    const next = [...effectiveOrder];
    [next[index], next[target]] = [next[target], next[index]];
    startDraft(next, effectiveLocks);
  }

  function toggleLock(trackId: string) {
    const next = new Set(effectiveLocks);
    if (next.has(trackId)) next.delete(trackId); else next.add(trackId);
    startDraft(effectiveOrder, next);
  }

  function directivePayload(order = effectiveOrder, nextLocks = effectiveLocks, nextVariant: Variant = (currentPlan?.plan_variant ?? variant)) {
    return {
      variant: nextVariant,
      preferredOrderTrackIds: order,
      lockedPositions: order.flatMap((trackId, position) => nextLocks.has(trackId) ? [{ trackId, position }] : []),
      transitionOverrides: records(directives.transition_overrides),
    };
  }

  async function derive(operation: string, extra: Record<string, unknown> = {}) {
    if (!currentJob) return;
    setBusy(operation); setError("");
    try {
      const payload = await post({
        action: "derive",
        parentJobId: currentJob.id,
        operation,
        setIntent: currentPlan?.set_intent ?? {},
        planDirectives: directivePayload(),
        ...extra,
      });
      const id = record(payload.job).id;
      if (typeof id === "string") setCurrentJobId(id);
      setDraftIdentity("");
      await load(true);
    } catch (value) { setError(value instanceof Error ? value.message : "Could not revise the local Set Plan."); }
    finally { setBusy(""); }
  }

  async function exclude(trackId: string) {
    if (!currentJob || currentOrder.length <= 2 || currentJob.purpose === "journey") return;
    const libraryId = snapshotByCandidate.get(trackId);
    if (!libraryId) return;
    const nextLibraryIds = snapshotLibraryIds.filter((id) => id !== libraryId);
    const nextOrder = effectiveOrder.filter((id) => id !== trackId);
    const nextLocks = new Set([...effectiveLocks].filter((id) => id !== trackId));
    await derive("exclude_track", {
      candidateRefs: nextLibraryIds.map((libraryTrackId) => ({ kind: "dj_library", libraryTrackId })),
      planDirectives: directivePayload(nextOrder, nextLocks),
    });
  }

  async function replace(oldTrackId: string, newLibraryId: string) {
    if (!currentJob || !newLibraryId || currentJob.purpose === "journey") return;
    const oldLibraryId = snapshotByCandidate.get(oldTrackId);
    if (!oldLibraryId) return;
    const newTrackId = candidateId(newLibraryId);
    const nextLibraryIds = snapshotLibraryIds.map((id) => id === oldLibraryId ? newLibraryId : id);
    const nextOrder = effectiveOrder.map((id) => id === oldTrackId ? newTrackId : id);
    const nextLocks = new Set([...effectiveLocks].map((id) => id === oldTrackId ? newTrackId : id));
    await derive("replace_track", {
      candidateRefs: nextLibraryIds.map((libraryTrackId) => ({ kind: "dj_library", libraryTrackId })),
      planDirectives: directivePayload(nextOrder, nextLocks),
    });
  }

  async function alternatives() {
    if (!currentJob) return;
    setBusy("alternatives"); setError("");
    try {
      const payload = await post({ action: "alternatives", parentJobId: currentJob.id, planDirectives: directivePayload() });
      const ids = Array.isArray(payload.jobs)
        ? payload.jobs.map(record).map((job) => typeof job.id === "string" ? job.id : "").filter(Boolean)
        : [];
      setComparisonIds(ids);
      await load(true);
    } catch (value) { setError(value instanceof Error ? value.message : "Could not generate local alternatives."); }
    finally { setBusy(""); }
  }

  async function render() {
    if (!currentJob) return;
    setBusy("render"); setError("");
    try {
      await post({ action: "render", parentJobId: currentJob.id });
      await load(true);
    } catch (value) { setError(value instanceof Error ? value.message : "Could not queue the approved local render."); }
    finally { setBusy(""); }
  }

  return (
    <section className={styles.builder} aria-label="Local Set Builder">
      <header className={styles.hero}>
        <div>
          <span className="section-label">Set Intelligence / device library</span>
          <h2>Plan in Ensemblis.<br /><em>Render where the music lives.</em></h2>
          <p>Local audio never enters the cloud. Only compact musical evidence reaches Set Intelligence, then your paired computer executes the exact approved MixPlan.</p>
        </div>
        <div className={styles.contract}><FiCpu /><span>Execution contract</span><strong>Cloud plan → frozen hash → local DSP</strong><small>One paired computer per local set in Phase 8.</small></div>
      </header>

      <div className={styles.setup}>
        <div className={styles.fields}>
          <label><span>Plan name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label>
          <label><span>Purpose</span><select value={purpose} onChange={(event) => { const next = event.target.value as AutoMixPurpose; setPurpose(next); if (next === "journey") setAllowOmissions(false); }}>{PURPOSES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <label><span>Duration</span><select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>{[10, 15, 20, 30, 45, 60].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Energy arc</span><select value={energy} onChange={(event) => setEnergy(event.target.value as AutoMixEnergyProfile)}><option value="smooth">Smooth</option><option value="dynamic">Dynamic</option><option value="peak">Peak</option></select></label>
          <label><span>Transitions</span><select value={style} onChange={(event) => setStyle(event.target.value as AutoMixTransitionStyle)}><option value="clean">Clean</option><option value="dj">DJ</option><option value="creative">Creative</option></select></label>
          <label><span>Local output</span><select value={format} onChange={(event) => setFormat(event.target.value as AutoMixOutputFormat)}><option value="mp3">320 kbps MP3</option><option value="wav">WAV</option></select></label>
        </div>
        <div className={styles.variantRail}>{VARIANTS.map((item) => <button key={item.id} type="button" className={variant === item.id ? styles.variantActive : ""} onClick={() => setVariant(item.id)}><strong>{item.label}</strong><small>{item.note}</small></button>)}</div>
        <label className={styles.curate}><input type="checkbox" checked={purpose === "journey" ? false : allowOmissions} disabled={purpose === "journey"} onChange={(event) => setAllowOmissions(event.target.checked)} /><span>Let Set Intelligence curate weaker candidates</span></label>

        <div className={styles.libraryHeading}>
          <div><span className="section-label">Local candidates</span><strong>{selected.length} selected · {readyTracks.length} planning-ready</strong></div>
          {selectedDevice ? <small><FiHardDrive /> Selection locked to one paired computer</small> : null}
        </div>
        <div className={styles.library}>
          {readyTracks.map((track, index) => {
            const chosen = selected.includes(track.id);
            const otherDevice = Boolean(selectedDevice && selectedDevice !== track.deviceId);
            return <button type="button" key={track.id} className={chosen ? styles.trackSelected : ""} disabled={otherDevice} onClick={() => selectTrack(track)}>
              <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.check}>{chosen ? <FiCheck /> : null}</span>
              <span className={styles.identity}><strong>{track.metadata.title || "Untitled"}</strong><small>{track.metadata.artist || "Local recording"} · {track.metadata.bpm ? `${track.metadata.bpm.toFixed(1)} BPM` : "tempo analyzed"} · {track.metadata.musicalKey || "key analyzed"}</small></span>
            </button>;
          })}
          {!loading && !readyTracks.length ? <div className={styles.empty}><FiHardDrive /><strong>No planning-ready local tracks yet.</strong><span>Pair the Library Bridge, choose a music folder, let local analysis finish, then sync the path-free evidence.</span></div> : null}
          {loading ? <div className={styles.empty}><FiRefreshCw className={styles.spin} /><span>Loading local library evidence…</span></div> : null}
        </div>
        <div className={styles.createBar}><div><strong>No audio upload.</strong><small>The planner receives fingerprints and musical evidence only.</small></div><button className="button button-primary" type="button" disabled={selected.length < 2 || Boolean(busy)} onClick={() => void createPlan()}>{busy === "create" ? <FiRefreshCw /> : <FiZap />} Build local Set Plan</button></div>
      </div>

      {error ? <div className={styles.error} role="alert"><FiX /><span>{error}</span></div> : null}

      <div className={styles.workspace}>
        <aside className={styles.revisions}><span className="section-label">Revisions</span>{planJobs.map((job) => { const plan = planFromJob(job); const revision = Number(lineage(job).revision ?? 1); return <button type="button" key={job.id} className={job.id === currentJob?.id ? styles.revisionActive : ""} onClick={() => setCurrentJobId(job.id)}><span>v{revision}</span><strong>{plan?.plan_variant ?? "recommended"}</strong><small>{status(job.status)} · {planHash(plan).slice(0, 7) || "planning"}</small></button>; })}{!planJobs.length ? <small>No local plans yet.</small> : null}</aside>
        <div className={styles.stage}>
          {!currentJob ? <div className={styles.blank}><FiShuffle /><h3>Choose local recordings and build a verified route.</h3><p>The route will be planned in the cloud from path-free evidence, then rendered only on the paired computer.</p></div>
            : !currentPlan ? <div className={styles.blank}><FiRefreshCw className={ACTIVE.has(currentJob.status) ? styles.spin : ""} /><h3>{currentJob.status === "failed" ? "This local plan needs attention." : "Set Intelligence is planning your local library."}</h3><p>{currentJob.error || "Evaluating global arc, phrase windows and adjacent transitions."}</p></div>
              : <>
                <header className={styles.planHeader}><div><span className="section-label">Local revision {String(lineage(currentJob).revision ?? 1)}</span><h3>{currentJob.name}</h3><p>{currentPlan.selection_summary?.selected_count ?? currentTracks.length} selected from {currentPlan.selection_summary?.candidate_count ?? snapshotLibraryIds.length} candidates</p></div><div className={styles.facts}><span><small>Duration</small><strong>{duration(currentPlan.estimated_duration_ms)}</strong></span><span><small>Confidence</small><strong>{percent(currentPlan.quality_summary?.mean_confidence)}</strong></span><span><small>Risk</small><strong>{currentPlan.quality_summary?.risky_transition_count ?? 0}</strong></span><span><small>Hash</small><strong>{planHash(currentPlan).slice(0, 9)}</strong></span></div></header>
                <ol className={styles.route}>{effectiveOrder.map((trackId, index) => { const track = currentTracks.find((item) => item.track_id === trackId); if (!track) return null; const locked = effectiveLocks.has(trackId); const transition = currentTransitions.find((item) => item.from_track_id === trackId && item.to_track_id === effectiveOrder[index + 1]); return <li key={trackId}>
                  <div className={styles.routeTrack}><span className={styles.routeIndex}>{String(index + 1).padStart(2, "0")}</span><div><strong>{track.title || "Untitled"}</strong><small>{track.playback_bpm ? `${track.playback_bpm.toFixed(1)} BPM` : "tempo preserved"}{track.key?.camelot ? ` · ${track.key.camelot}` : ""}{locked ? " · locked" : ""}</small></div><div className={styles.tools}><button type="button" onClick={() => toggleLock(trackId)} title={locked ? "Unlock position" : "Lock position"}>{locked ? <FiLock /> : <FiUnlock />}</button><button type="button" disabled={index === 0} onClick={() => move(index, -1)}><FiArrowUp /></button><button type="button" disabled={index === effectiveOrder.length - 1} onClick={() => move(index, 1)}><FiArrowDown /></button>{currentJob.purpose !== "journey" && replacements.length ? <select aria-label={`Replace ${track.title}`} defaultValue="" onChange={(event) => { const id = event.target.value; event.currentTarget.value = ""; if (id) void replace(trackId, id); }}><option value="">Replace…</option>{replacements.map((item) => <option value={item.id} key={item.id}>{item.metadata.title}</option>)}</select> : null}{currentJob.purpose !== "journey" ? <button type="button" disabled={currentOrder.length <= 2} onClick={() => void exclude(trackId)} title="Exclude"><FiX /></button> : null}</div></div>
                  {transition ? <div className={styles.transition}><span className={transition.risk_flags?.length ? styles.riskDot : styles.safeDot} /><div><strong>{technique(transition.technique)}</strong><small>{transition.beatmatch ? `${transition.bars ?? 0} bars · beatmatched` : "phrase-safe"} · confidence {percent(transition.confidence)}</small></div><div className={styles.metrics}><span>Fit <b>{percent(transition.score)}</b></span><span>Harmonic <b>{percent(transition.metrics?.harmonic)}</b></span><span>Stretch <b>{typeof transition.metrics?.stretch_delta === "number" ? `${(transition.metrics.stretch_delta * 100).toFixed(1)}%` : "—"}</b></span></div></div> : null}
                </li>; })}</ol>
                <div className={styles.decisions}><div><strong>Freeze only what you approve.</strong><small>The paired computer receives this exact MixPlan hash and re-verifies every recording before DSP.</small></div><div><button className="button" type="button" disabled={!canEdit || Boolean(busy) || !dirty} onClick={() => void derive("reorder_and_lock")}><FiShuffle /> Replan edits</button><button className="button" type="button" disabled={!canEdit || Boolean(busy)} onClick={() => void alternatives()}><FiGitBranch /> Compare</button><button className="button button-primary" type="button" disabled={!canEdit || dirty || Boolean(busy) || Boolean(renderJobs.find((job) => ACTIVE.has(job.status)))} onClick={() => void render()}>{busy === "render" ? <FiRefreshCw /> : <FiPlay />} Approve & render locally</button></div></div>
              </>}
        </div>
      </div>

      {comparisonIds.length ? <div className={styles.comparisons}>{comparisonIds.map((id) => { const job = planJobs.find((item) => item.id === id); const plan = planFromJob(job); return <article key={id}><span className="section-label">{plan?.plan_variant ?? "variant"}</span><strong>{job ? status(job.status) : "Queued"}</strong><small>{percent(plan?.quality_summary?.mean_confidence)} confidence · {plan?.quality_summary?.risky_transition_count ?? "—"} risky handoffs</small><button className="button" type="button" disabled={!job || job.status !== "completed"} onClick={() => job && setCurrentJobId(job.id)}>Open plan</button></article>; })}</div> : null}

      {latestRender ? <div className={styles.renderStatus}><div><span className="section-label">Device render</span><h3>{ACTIVE.has(latestRender.status) ? "Your paired computer is executing the frozen MixPlan." : latestRender.status === "completed" ? "The approved local mix is ready on your computer." : "The local render needs attention."}</h3><p>{latestRender.error || (latestRender.status === "completed" ? "The output stayed device-local. Open the Library Bridge to export the rendered file." : "No source path or local audio is being transferred to Ensemblis.")}</p></div><strong>{status(latestRender.status)}</strong></div> : null}
    </section>
  );
}
