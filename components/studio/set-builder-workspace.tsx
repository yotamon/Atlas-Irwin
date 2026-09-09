"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  FiArrowDown,
  FiArrowUp,
  FiCheck,
  FiGitBranch,
  FiHeadphones,
  FiLock,
  FiPlay,
  FiRefreshCw,
  FiShuffle,
  FiSliders,
  FiUnlock,
  FiX,
  FiZap,
} from "react-icons/fi";
import type {
  AutoMixEnergyProfile,
  AutoMixJob,
  AutoMixOutputFormat,
  AutoMixPurpose,
  AutoMixTransitionPreview,
  AutoMixTransitionStyle,
} from "@/types/automix-database";
import styles from "./set-builder-workspace.module.css";

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
type PreviewView = AutoMixTransitionPreview & { preview_url?: string | null };
type PlanVariant = "safe" | "recommended" | "adventurous";

type PlanTrack = {
  track_id?: string;
  title?: string;
  playback_bpm?: number;
  source_bpm?: number;
  energy?: number;
  position_locked?: boolean;
  key?: { label?: string; camelot?: string; confidence?: number };
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
  reasons?: string[];
  user_override?: boolean;
  metrics?: {
    harmonic?: number;
    stretch_delta?: number;
    vocal_collision?: number;
    bass_collision?: number;
  };
};

type SetBuilderPlan = {
  estimated_duration_ms?: number;
  requested_duration_ms?: number;
  plan_variant?: PlanVariant;
  tracks?: PlanTrack[];
  transitions?: PlanTransition[];
  quality_summary?: {
    mean_score?: number;
    mean_confidence?: number;
    minimum_confidence?: number;
    risky_transition_count?: number;
  };
  selection_summary?: {
    candidate_count?: number;
    selected_count?: number;
    omitted_count?: number;
  };
  omitted_tracks?: Array<{ track_id?: string; title?: string; reason?: string }>;
  set_intent?: Record<string, unknown>;
  plan_directives?: Record<string, unknown>;
  plan_lineage?: Record<string, unknown>;
  render_manifest?: { plan_hash?: string };
  evaluation?: Record<string, unknown>;
};

type SetBuilderWorkspaceProps = {
  artistId: string;
  artistName: string;
  tracks: TrackOption[];
};

const ACTIVE = new Set<AutoMixJob["status"]>(["planned", "queued", "running"]);
const PREVIEW_ACTIVE = new Set<AutoMixTransitionPreview["status"]>(["planned", "queued", "running"]);
const VARIANTS: Array<{ id: PlanVariant; label: string; description: string }> = [
  { id: "safe", label: "Safe", description: "Prioritizes structural confidence, stable tempo and low collision risk." },
  { id: "recommended", label: "Recommended", description: "The balanced Ensemblis route: musical, coherent and expressive." },
  { id: "adventurous", label: "Adventurous", description: "Allows more harmonic contrast and bolder sequencing without relaxing safety." },
];
const PURPOSES: Array<{ id: AutoMixPurpose; label: string }> = [
  { id: "booking", label: "Booking mix" },
  { id: "soundcloud", label: "SoundCloud" },
  { id: "journey", label: "Artist journey" },
  { id: "peak_time", label: "Peak time" },
  { id: "warm_up", label: "Warm-up" },
  { id: "discovery", label: "Discovery" },
];
const TECHNIQUES = [
  ["quick_mix", "Quick mix"],
  ["bass_swap", "Bass swap"],
  ["harmonic_blend", "Harmonic blend"],
  ["breakdown_swap", "Breakdown swap"],
  ["echo_out", "Echo out"],
  ["drop_cut", "Drop cut"],
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function records(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function responseError(value: unknown, fallback: string) {
  const body = asRecord(value);
  return typeof body.error === "string" ? body.error : fallback;
}

function requestPayload(job: JobView) {
  return asRecord(job.request_payload);
}

function resultPayload(job: JobView) {
  return asRecord(job.result_payload);
}

function executionMode(job: JobView) {
  const mode = requestPayload(job).execution_mode;
  return typeof mode === "string" ? mode : "render";
}

function planFromJob(job: JobView | null | undefined): SetBuilderPlan | null {
  if (!job) return null;
  const plan = resultPayload(job).plan;
  return plan && typeof plan === "object" && !Array.isArray(plan) ? plan as SetBuilderPlan : null;
}

function lineageFromJob(job: JobView | null | undefined) {
  if (!job) return {};
  const requestLineage = asRecord(requestPayload(job).plan_lineage);
  const planLineage = asRecord(planFromJob(job)?.plan_lineage);
  return Object.keys(requestLineage).length ? requestLineage : planLineage;
}

function directivesFromPlan(plan: SetBuilderPlan | null) {
  return asRecord(plan?.plan_directives);
}

function formatDuration(ms: number | null | undefined) {
  if (!ms || ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function percent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

function techniqueLabel(value: string | undefined) {
  if (!value) return "Transition";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusLabel(status: AutoMixJob["status"]) {
  return {
    planned: "Waiting",
    queued: "Queued",
    running: "Working",
    completed: "Ready",
    failed: "Failed",
    cancelled: "Cancelled",
  }[status];
}

function planHash(plan: SetBuilderPlan | null) {
  const hash = plan?.render_manifest?.plan_hash;
  return typeof hash === "string" ? hash : "";
}

function variantFromPlan(plan: SetBuilderPlan | null): PlanVariant {
  const value = plan?.plan_variant ?? directivesFromPlan(plan).variant;
  return value === "safe" || value === "adventurous" ? value : "recommended";
}

function locksFromPlan(plan: SetBuilderPlan | null) {
  const locks = records(directivesFromPlan(plan).locked_positions);
  return new Set(locks.map((item) => String(item.track_id ?? "")).filter(Boolean));
}

function overridesFromPlan(plan: SetBuilderPlan | null) {
  return records(directivesFromPlan(plan).transition_overrides).map((item) => ({
    from_track_id: String(item.from_track_id ?? ""),
    to_track_id: String(item.to_track_id ?? ""),
    technique: String(item.technique ?? ""),
  })).filter((item) => item.from_track_id && item.to_track_id && item.technique);
}

function setIntentForRequest(plan: SetBuilderPlan | null) {
  return asRecord(plan?.set_intent);
}

function lockedPositions(order: string[], locked: Set<string>) {
  return order.flatMap((trackId, position) => locked.has(trackId) ? [{ trackId, position }] : []);
}

function previewStatus(preview: PreviewView | undefined) {
  if (!preview) return "Preview handoff";
  return {
    planned: "Waiting…",
    queued: "Queued…",
    running: "Rendering…",
    completed: preview.preview_url ? "Refresh link" : "Preview ready",
    failed: "Retry preview",
    cancelled: "Retry preview",
  }[preview.status];
}

export function SetBuilderWorkspace({ artistId, artistName, tracks }: SetBuilderWorkspaceProps) {
  const available = useMemo(() => tracks.filter((track) => Boolean(track.audio_url)).slice(0, 20), [tracks]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [name, setName] = useState(`${artistName} Set Plan`);
  const [purpose, setPurpose] = useState<AutoMixPurpose>("booking");
  const [energyProfile, setEnergyProfile] = useState<AutoMixEnergyProfile>("dynamic");
  const [transitionStyle, setTransitionStyle] = useState<AutoMixTransitionStyle>("dj");
  const [outputFormat, setOutputFormat] = useState<AutoMixOutputFormat>("mp3");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [variant, setVariant] = useState<PlanVariant>("recommended");
  const [allowOmissions, setAllowOmissions] = useState(true);
  const [targetCount, setTargetCount] = useState("auto");
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [currentJobId, setCurrentJobId] = useState("");
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [draftLocks, setDraftLocks] = useState<Set<string>>(new Set());
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<number, PreviewView>>({});
  const [previewBusy, setPreviewBusy] = useState<number | null>(null);

  const fetchJobs = useCallback(async () => {
    const response = await fetch(`/api/studio/automix?artist=${encodeURIComponent(artistId)}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(responseError(body, "Could not load Set Builder revisions."));
    const bodyRecord = asRecord(body);
    return Array.isArray(bodyRecord.jobs) ? bodyRecord.jobs as JobView[] : [];
  }, [artistId]);

  const loadJobs = useCallback(async (quiet = false) => {
    try {
      const next = await fetchJobs();
      setJobs(next);
    } catch (loadError) {
      if (!quiet) setError(loadError instanceof Error ? loadError.message : "Could not load Set Builder revisions.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [fetchJobs]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const builderJobs = useMemo(
    () => jobs.filter((job) => ["plan_only", "approved_render"].includes(executionMode(job))),
    [jobs],
  );
  const planJobs = useMemo(() => builderJobs.filter((job) => executionMode(job) === "plan_only"), [builderJobs]);
  const renderJobs = useMemo(() => builderJobs.filter((job) => executionMode(job) === "approved_render"), [builderJobs]);

  useEffect(() => {
    if (currentJobId && planJobs.some((job) => job.id === currentJobId)) return;
    const preferred = planJobs.find((job) => job.status === "completed") ?? planJobs[0];
    if (preferred) setCurrentJobId(preferred.id);
  }, [currentJobId, planJobs]);

  useEffect(() => {
    if (!builderJobs.some((job) => ACTIVE.has(job.status))) return;
    const timer = window.setInterval(() => void loadJobs(true), 2500);
    return () => window.clearInterval(timer);
  }, [builderJobs, loadJobs]);

  const currentJob = planJobs.find((job) => job.id === currentJobId) ?? null;
  const currentPlan = planFromJob(currentJob);
  const currentTracks = useMemo(() => Array.isArray(currentPlan?.tracks) ? currentPlan.tracks : [], [currentPlan]);
  const currentTransitions = useMemo(() => Array.isArray(currentPlan?.transitions) ? currentPlan.transitions : [], [currentPlan]);
  const currentTrackIds = useMemo(
    () => currentTracks.map((track) => String(track.track_id ?? "")).filter(Boolean),
    [currentTracks],
  );
  const planIdentity = `${currentJob?.id ?? ""}:${planHash(currentPlan)}`;

  useEffect(() => {
    setDraftOrder(currentTrackIds);
    setDraftLocks(locksFromPlan(currentPlan));
  // currentTrackIds is derived from the selected immutable plan revision; planIdentity is the reset boundary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planIdentity]);

  const loadPreviews = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/studio/automix/previews?artist=${encodeURIComponent(artistId)}&job=${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(responseError(body, "Could not load transition previews."));
    const list = Array.isArray(asRecord(body).previews) ? asRecord(body).previews as PreviewView[] : [];
    const next: Record<number, PreviewView> = {};
    for (const preview of list) next[preview.transition_index] = preview;
    setPreviews(next);
  }, [artistId]);

  useEffect(() => {
    setPreviews({});
    if (!currentJob || currentJob.status !== "completed") return;
    void loadPreviews(currentJob.id).catch(() => undefined);
  }, [currentJob?.id, currentJob?.status, loadPreviews]);

  const hasActivePreview = Object.values(previews).some((preview) => PREVIEW_ACTIVE.has(preview.status));
  useEffect(() => {
    if (!currentJob || !hasActivePreview) return;
    const timer = window.setInterval(() => void loadPreviews(currentJob.id).catch(() => undefined), 2200);
    return () => window.clearInterval(timer);
  }, [currentJob, hasActivePreview, loadPreviews]);

  const draftDirty = currentTrackIds.join("|") !== draftOrder.join("|")
    || [...locksFromPlan(currentPlan)].sort().join("|") !== [...draftLocks].sort().join("|");

  const comparisonJobs = comparisonIds
    .map((id) => planJobs.find((job) => job.id === id))
    .filter((job): job is JobView => Boolean(job));
  const planTrackIdSet = new Set(currentTrackIds);
  const replacementOptions = available.filter((track) => !planTrackIdSet.has(track.id));
  const currentLineage = lineageFromJob(currentJob);
  const currentRevision = typeof currentLineage.revision === "number" ? currentLineage.revision : 1;
  const currentVariant = variantFromPlan(currentPlan);
  const canEdit = Boolean(currentJob && currentJob.status === "completed" && currentPlan && currentTrackIds.length >= 2);
  const activeRender = renderJobs.find((job) => ACTIVE.has(job.status));
  const latestRender = renderJobs[0] ?? null;

  function toggleCandidate(trackId: string) {
    setSelectedIds((current) => current.includes(trackId)
      ? current.filter((id) => id !== trackId)
      : current.length < 20 ? [...current, trackId] : current);
  }

  async function postAction(body: Record<string, unknown>) {
    const response = await fetch("/api/studio/automix/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artistId, ...body }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(responseError(payload, "Set Builder could not complete this operation."));
    return asRecord(payload);
  }

  async function createPlan() {
    if (selectedIds.length < 2) {
      setError("Choose at least two mastered candidates before planning the set.");
      return;
    }
    setBusy("create");
    setError("");
    try {
      const payload = await postAction({
        action: "create",
        trackIds: selectedIds,
        name,
        purpose,
        energyProfile,
        transitionStyle,
        outputFormat,
        durationMs: durationMinutes * 60_000,
        variant,
        setIntent: {
          allowOmissions: purpose === "journey" ? false : allowOmissions,
          mustPlayTrackIds: purpose === "journey" ? selectedIds : [],
          targetTrackCount: targetCount === "auto" ? null : Number(targetCount),
        },
        planDirectives: {
          variant,
          preferredOrderTrackIds: selectedIds,
          lockedPositions: purpose === "journey"
            ? selectedIds.map((trackId, position) => ({ trackId, position }))
            : [],
          transitionOverrides: [],
        },
      });
      const job = asRecord(payload.job);
      if (typeof job.id === "string") setCurrentJobId(job.id);
      await loadJobs(true);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the set plan.");
    } finally {
      setBusy("");
    }
  }

  function directivePayload(
    order = draftOrder,
    locks = draftLocks,
    overrides = overridesFromPlan(currentPlan),
    nextVariant = currentVariant,
  ) {
    return {
      variant: nextVariant,
      preferredOrderTrackIds: order,
      lockedPositions: lockedPositions(order, locks),
      transitionOverrides: overrides,
    };
  }

  async function derivePlan({
    operation,
    order = draftOrder,
    locks = draftLocks,
    overrides = overridesFromPlan(currentPlan),
    setIntent = setIntentForRequest(currentPlan),
    trackIds = currentJob?.track_ids ?? [],
  }: {
    operation: string;
    order?: string[];
    locks?: Set<string>;
    overrides?: Array<Record<string, unknown>>;
    setIntent?: Record<string, unknown>;
    trackIds?: string[];
  }) {
    if (!currentJob) return;
    setBusy(operation);
    setError("");
    try {
      const payload = await postAction({
        action: "derive",
        parentJobId: currentJob.id,
        operation,
        trackIds,
        setIntent,
        planDirectives: directivePayload(order, locks, overrides),
      });
      const job = asRecord(payload.job);
      if (typeof job.id === "string") setCurrentJobId(job.id);
      await loadJobs(true);
    } catch (deriveError) {
      setError(deriveError instanceof Error ? deriveError.message : "Could not create a new plan revision.");
    } finally {
      setBusy("");
    }
  }

  function moveDraft(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draftOrder.length) return;
    setDraftOrder((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function toggleDraftLock(trackId: string) {
    setDraftLocks((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }

  async function excludeTrack(trackId: string) {
    if (!currentJob || !currentPlan || currentTracks.length <= 2 || currentJob.purpose === "journey") return;
    const intent = setIntentForRequest(currentPlan);
    const blocked = new Set(stringArray(intent.blocked_track_ids));
    const must = new Set(stringArray(intent.must_play_track_ids));
    blocked.add(trackId);
    must.delete(trackId);
    const order = draftOrder.filter((id) => id !== trackId);
    const locks = new Set([...draftLocks].filter((id) => id !== trackId));
    const overrides = overridesFromPlan(currentPlan).filter((item) => item.from_track_id !== trackId && item.to_track_id !== trackId);
    await derivePlan({
      operation: "exclude_track",
      order,
      locks,
      overrides,
      setIntent: { ...intent, blocked_track_ids: [...blocked], must_play_track_ids: [...must] },
    });
  }

  async function replaceTrack(oldTrackId: string, newTrackId: string) {
    if (!currentJob || !currentPlan || !newTrackId || oldTrackId === newTrackId || currentJob.purpose === "journey") return;
    const intent = setIntentForRequest(currentPlan);
    const blocked = new Set(stringArray(intent.blocked_track_ids));
    const must = new Set(stringArray(intent.must_play_track_ids));
    blocked.add(oldTrackId);
    blocked.delete(newTrackId);
    must.delete(oldTrackId);
    must.add(newTrackId);
    const order = draftOrder.map((id) => id === oldTrackId ? newTrackId : id);
    const locks = new Set([...draftLocks].map((id) => id === oldTrackId ? newTrackId : id));
    const overrides = overridesFromPlan(currentPlan).filter((item) => item.from_track_id !== oldTrackId && item.to_track_id !== oldTrackId);
    const trackIds = currentJob.track_ids.includes(newTrackId)
      ? currentJob.track_ids
      : [...currentJob.track_ids, newTrackId].slice(0, 20);
    await derivePlan({
      operation: "replace_track",
      order,
      locks,
      overrides,
      trackIds,
      setIntent: { ...intent, blocked_track_ids: [...blocked], must_play_track_ids: [...must] },
    });
  }

  async function overrideTransition(transition: PlanTransition, technique: string) {
    if (!transition.from_track_id || !transition.to_track_id) return;
    const overrides = overridesFromPlan(currentPlan).filter((item) => !(
      item.from_track_id === transition.from_track_id && item.to_track_id === transition.to_track_id
    ));
    if (technique) overrides.push({
      from_track_id: transition.from_track_id,
      to_track_id: transition.to_track_id,
      technique,
    });
    await derivePlan({ operation: technique ? "override_transition" : "reset_transition", overrides });
  }

  async function generateAlternatives() {
    if (!currentJob) return;
    setBusy("alternatives");
    setError("");
    try {
      const payload = await postAction({
        action: "alternatives",
        parentJobId: currentJob.id,
        setIntent: setIntentForRequest(currentPlan),
        planDirectives: directivePayload(),
      });
      const ids = Array.isArray(payload.jobs)
        ? payload.jobs.map(asRecord).map((job) => typeof job.id === "string" ? job.id : "").filter(Boolean)
        : [];
      setComparisonIds(ids);
      await loadJobs(true);
    } catch (alternativesError) {
      setError(alternativesError instanceof Error ? alternativesError.message : "Could not generate plan alternatives.");
    } finally {
      setBusy("");
    }
  }

  async function approveRender() {
    if (!currentJob) return;
    setBusy("render");
    setError("");
    try {
      await postAction({ action: "render", parentJobId: currentJob.id });
      await loadJobs(true);
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : "Could not start the approved render.");
    } finally {
      setBusy("");
    }
  }

  async function requestPreview(index: number) {
    if (!currentJob || previewBusy !== null) return;
    setPreviewBusy(index);
    setError("");
    try {
      const response = await fetch("/api/studio/automix/previews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artistId, jobId: currentJob.id, transitionIndex: index }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(body, "Could not create the transition preview."));
      const preview = asRecord(body).preview;
      if (preview && typeof preview === "object" && !Array.isArray(preview)) {
        setPreviews((current) => ({ ...current, [index]: preview as PreviewView }));
      }
      await loadPreviews(currentJob.id).catch(() => undefined);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Could not create the transition preview.");
    } finally {
      setPreviewBusy(null);
    }
  }

  return (
    <section className={styles.builder} aria-label="Set Builder">
      <header className={styles.builderHero}>
        <div>
          <span className="section-label">Set Intelligence / plan first</span>
          <h2>Program the set.<br /><em>Approve the performance.</em></h2>
          <p>
            Ensemblis now separates musical planning from rendering. Build a verified route, audition handoffs,
            lock decisions, compare alternatives and render only the MixPlan you approve.
          </p>
        </div>
        <div className={styles.heroContract}>
          <span>Contract</span>
          <strong>Plan → Review → Revise → Render</strong>
          <small>No edit bypasses the canonical DJ planner or its safety constraints.</small>
        </div>
      </header>

      <div className={styles.setupGrid}>
        <aside className={styles.setupIntro}>
          <span className="section-label">01 / Brief</span>
          <h3>Give the engine room to think.</h3>
          <p>Choose a candidate pool, not a forced playlist. The plan can curate weaker material while preserving your hard choices.</p>
        </aside>
        <div className={styles.setupBody}>
          <div className={styles.fields}>
            <label className="field"><span>Plan name</span><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
            <label className="field"><span>Purpose</span><select value={purpose} onChange={(event) => { const next = event.target.value as AutoMixPurpose; setPurpose(next); if (next === "journey") setAllowOmissions(false); }}>{PURPOSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="field"><span>Duration</span><select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>{[10, 15, 20, 30, 45, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label>
            <label className="field"><span>Energy arc</span><select value={energyProfile} onChange={(event) => setEnergyProfile(event.target.value as AutoMixEnergyProfile)}><option value="smooth">Smooth</option><option value="dynamic">Dynamic</option><option value="peak">Peak</option></select></label>
            <label className="field"><span>Transition character</span><select value={transitionStyle} onChange={(event) => setTransitionStyle(event.target.value as AutoMixTransitionStyle)}><option value="clean">Clean</option><option value="dj">DJ</option><option value="creative">Creative</option></select></label>
            <label className="field"><span>Output after approval</span><select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as AutoMixOutputFormat)}><option value="mp3">320 kbps MP3</option><option value="wav">24-bit WAV</option></select></label>
            <label className="field"><span>Candidate policy</span><select disabled={purpose === "journey"} value={allowOmissions ? "curate" : "all"} onChange={(event) => setAllowOmissions(event.target.value === "curate")}><option value="curate">Curate for the set</option><option value="all">Keep every candidate</option></select></label>
            <label className="field"><span>Target tracks</span><select disabled={!allowOmissions || purpose === "journey"} value={targetCount} onChange={(event) => setTargetCount(event.target.value)}><option value="auto">Automatic</option>{Array.from({ length: Math.max(0, selectedIds.length - 1) }, (_, index) => index + 2).map((count) => <option key={count} value={String(count)}>{count} tracks</option>)}</select></label>
          </div>

          <div className={styles.variantRail} aria-label="Plan character">
            {VARIANTS.map((item) => (
              <button key={item.id} type="button" className={variant === item.id ? styles.variantActive : ""} onClick={() => setVariant(item.id)}>
                <strong>{item.label}</strong><small>{item.description}</small>
              </button>
            ))}
          </div>

          <div className={styles.catalogHeader}>
            <div><span className="section-label">Candidate pool</span><strong>{selectedIds.length} / {available.length} mastered tracks</strong></div>
            <div className={styles.inlineActions}>
              <button type="button" onClick={() => setSelectedIds(available.map((track) => track.id))}>Use all</button>
              <button type="button" onClick={() => setSelectedIds([])}>Clear</button>
            </div>
          </div>
          <div className={styles.catalog}>
            {available.map((track, index) => {
              const selected = selectedIds.includes(track.id);
              return (
                <button key={track.id} type="button" className={selected ? styles.catalogSelected : ""} aria-pressed={selected} onClick={() => toggleCandidate(track.id)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.catalogCheck}>{selected ? <FiCheck /> : null}</span>
                  <strong>{track.title}</strong>
                  <small>{track.is_primary ? "Primary master" : "Canonical master"}</small>
                </button>
              );
            })}
            {!available.length ? <p className={styles.empty}>Add at least two canonical masters to use Set Builder.</p> : null}
          </div>
          <div className={styles.planCta}>
            <div><strong>Planning is non-destructive.</strong><small>No mix file is rendered until you approve a verified revision.</small></div>
            <button className="button button-primary" type="button" disabled={busy === "create" || selectedIds.length < 2} onClick={() => void createPlan()}>
              {busy === "create" ? <FiRefreshCw aria-hidden /> : <FiZap aria-hidden />} Build verified plan
            </button>
          </div>
        </div>
      </div>

      {error ? <div className={styles.error} role="alert"><FiX aria-hidden /><span>{error}</span></div> : null}

      <div className={styles.workspaceGrid}>
        <aside className={styles.revisions}>
          <div className={styles.revisionsHeading}>
            <span className="section-label">02 / Revisions</span>
            <strong>{planJobs.length ? `${planJobs.length} durable plan${planJobs.length === 1 ? "" : "s"}` : "No plans yet"}</strong>
          </div>
          <div className={styles.revisionList}>
            {planJobs.map((job) => {
              const plan = planFromJob(job);
              const lineage = lineageFromJob(job);
              const revision = typeof lineage.revision === "number" ? lineage.revision : 1;
              const selected = job.id === currentJobId;
              return (
                <button key={job.id} type="button" className={selected ? styles.revisionActive : ""} onClick={() => setCurrentJobId(job.id)}>
                  <span className={styles.revisionNumber}>v{revision}</span>
                  <span><strong>{variantFromPlan(plan)}</strong><small>{statusLabel(job.status)} · {planHash(plan) ? planHash(plan).slice(0, 7) : "planning"}</small></span>
                  <FiGitBranch aria-hidden />
                </button>
              );
            })}
          </div>
          {loading ? <p className={styles.muted}>Loading revision history…</p> : null}
        </aside>

        <div className={styles.planStage}>
          {!currentJob ? (
            <div className={styles.blankPlan}>
              <FiSliders aria-hidden />
              <h3>Your first Set Plan will live here.</h3>
              <p>Planning creates a verified MixPlan you can inspect before spending time on a full render.</p>
            </div>
          ) : !currentPlan ? (
            <div className={styles.blankPlan}>
              <FiRefreshCw className={ACTIVE.has(currentJob.status) ? styles.spin : ""} aria-hidden />
              <h3>{currentJob.status === "failed" ? "This revision could not be planned." : "Set Intelligence is building the route."}</h3>
              <p>{currentJob.error || "Analyzing the candidate pool, global arc and every adjacent handoff."}</p>
            </div>
          ) : (
            <>
              <header className={styles.planHeader}>
                <div>
                  <span className="section-label">Revision {currentRevision} / {currentVariant}</span>
                  <h3>{currentJob.name}</h3>
                  <p>
                    {currentPlan.selection_summary?.selected_count ?? currentTracks.length} selected from {currentPlan.selection_summary?.candidate_count ?? currentJob.track_ids.length} candidates
                    {currentPlan.selection_summary?.omitted_count ? ` · ${currentPlan.selection_summary.omitted_count} omitted` : ""}
                  </p>
                </div>
                <div className={styles.planFacts}>
                  <span><small>Duration</small><strong>{formatDuration(currentPlan.estimated_duration_ms)}</strong></span>
                  <span><small>Mean confidence</small><strong>{percent(currentPlan.quality_summary?.mean_confidence)}</strong></span>
                  <span><small>Risk flags</small><strong>{currentPlan.quality_summary?.risky_transition_count ?? 0}</strong></span>
                  <span><small>Plan hash</small><strong>{planHash(currentPlan).slice(0, 9) || "—"}</strong></span>
                </div>
              </header>

              <section className={styles.trajectory} aria-label="Set energy and BPM trajectory">
                <div className={styles.trajectoryHeading}><span className="section-label">Global arc</span><small>Energy height · playback BPM</small></div>
                <div className={styles.trajectoryPlot}>
                  {currentTracks.map((track, index) => {
                    const energy = typeof track.energy === "number" ? Math.max(0.08, Math.min(1, track.energy)) : 0.35;
                    return (
                      <div key={`${track.track_id}-${index}`} className={styles.trajectoryPoint} title={`${track.title ?? "Track"} · ${percent(track.energy)}`}>
                        <div className={styles.energyBar} style={{ "--energy": `${Math.round(energy * 100)}%` } as CSSProperties} />
                        <small>{typeof track.playback_bpm === "number" ? Math.round(track.playback_bpm) : "—"}</small>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className={styles.editor}>
                <div className={styles.editorHeading}>
                  <div><span className="section-label">Route editor</span><strong>Locks are hard. Order is a preference until you lock it.</strong></div>
                  <button className="button" type="button" disabled={!canEdit || !draftDirty || Boolean(busy)} onClick={() => void derivePlan({ operation: "reorder_and_lock" })}>
                    {busy === "reorder_and_lock" ? <FiRefreshCw aria-hidden /> : <FiShuffle aria-hidden />} Replan around edits
                  </button>
                </div>

                <ol className={styles.route}>
                  {draftOrder.map((trackId, index) => {
                    const track = currentTracks.find((item) => item.track_id === trackId);
                    if (!track) return null;
                    const locked = draftLocks.has(trackId);
                    const transition = currentTransitions.find((item) => item.from_track_id === trackId && item.to_track_id === draftOrder[index + 1]);
                    const originalTransitionIndex = transition ? currentTransitions.indexOf(transition) : -1;
                    const preview = originalTransitionIndex >= 0 ? previews[originalTransitionIndex] : undefined;
                    return (
                      <li key={trackId}>
                        <div className={styles.trackRow}>
                          <span className={styles.trackIndex}>{String(index + 1).padStart(2, "0")}</span>
                          <div className={styles.trackIdentity}>
                            <strong>{track.title || "Untitled track"}</strong>
                            <small>
                              {typeof track.playback_bpm === "number" ? `${track.playback_bpm.toFixed(1)} BPM` : "Tempo preserved"}
                              {track.key?.camelot ? ` · ${track.key.camelot}` : ""}
                              {locked ? " · position locked" : ""}
                            </small>
                            {track.selection_reasons?.length ? <span>{track.selection_reasons.join(" · ")}</span> : null}
                          </div>
                          <div className={styles.trackTools}>
                            <button type="button" title={locked ? "Unlock position" : "Lock this position"} aria-label={locked ? `Unlock ${track.title}` : `Lock ${track.title}`} aria-pressed={locked} onClick={() => toggleDraftLock(trackId)}>{locked ? <FiLock /> : <FiUnlock />}</button>
                            <button type="button" title="Move up" aria-label={`Move ${track.title} up`} disabled={index === 0} onClick={() => moveDraft(index, -1)}><FiArrowUp /></button>
                            <button type="button" title="Move down" aria-label={`Move ${track.title} down`} disabled={index === draftOrder.length - 1} onClick={() => moveDraft(index, 1)}><FiArrowDown /></button>
                            {currentJob.purpose !== "journey" && replacementOptions.length ? (
                              <select aria-label={`Replace ${track.title}`} defaultValue="" onChange={(event) => { const next = event.target.value; event.currentTarget.value = ""; if (next) void replaceTrack(trackId, next); }}>
                                <option value="">Replace…</option>
                                {replacementOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
                              </select>
                            ) : null}
                            {currentJob.purpose !== "journey" ? <button type="button" title="Exclude from next revision" aria-label={`Exclude ${track.title}`} disabled={currentTracks.length <= 2} onClick={() => void excludeTrack(trackId)}><FiX /></button> : null}
                          </div>
                        </div>

                        {transition ? (
                          <div className={styles.handoff}>
                            <div className={styles.handoffLead}>
                              <span className={transition.risk_flags?.length ? styles.riskDot : styles.safeDot} />
                              <div><strong>{techniqueLabel(transition.technique)}</strong><small>{transition.beatmatch ? `${transition.bars ?? 0} bars · beatmatched` : "phrase-safe handoff"} · confidence {percent(transition.confidence)}</small></div>
                            </div>
                            <div className={styles.handoffMetrics}>
                              <span>Fit <b>{percent(transition.score)}</b></span>
                              <span>Harmonic <b>{percent(transition.metrics?.harmonic)}</b></span>
                              <span>Vocal <b>{percent(transition.metrics?.vocal_collision)}</b></span>
                              <span>Stretch <b>{typeof transition.metrics?.stretch_delta === "number" ? `${(transition.metrics.stretch_delta * 100).toFixed(1)}%` : "—"}</b></span>
                            </div>
                            <div className={styles.handoffTools}>
                              <label><span>Technique</span><select value={transition.user_override ? transition.technique ?? "" : ""} onChange={(event) => void overrideTransition(transition, event.target.value)} disabled={!canEdit || Boolean(busy)}><option value="">Auto</option>{TECHNIQUES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                              {originalTransitionIndex >= 0 ? <button type="button" disabled={!canEdit || previewBusy !== null || Boolean(preview && PREVIEW_ACTIVE.has(preview.status))} onClick={() => void requestPreview(originalTransitionIndex)}>{previewBusy === originalTransitionIndex || (preview && PREVIEW_ACTIVE.has(preview.status)) ? <FiRefreshCw aria-hidden /> : <FiHeadphones aria-hidden />}{previewStatus(preview)}</button> : null}
                            </div>
                            {transition.risk_flags?.length ? <p className={styles.risks}>{transition.risk_flags.map((flag) => flag.replaceAll("_", " ")).join(" · ")}</p> : transition.reasons?.length ? <p>{transition.reasons.join(" · ")}</p> : null}
                            {preview?.status === "completed" && preview.preview_url ? <audio className={styles.previewPlayer} controls preload="metadata" src={preview.preview_url}>Your browser does not support audio playback.</audio> : null}
                            {preview?.error ? <p className={styles.risks}>{preview.error}</p> : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </section>

              <section className={styles.decisionBar}>
                <div>
                  <span className="section-label">Decision point</span>
                  <strong>Keep shaping this route, compare three planner personalities, or freeze it for render.</strong>
                  <small>Render uses this exact verified MixPlan hash. It does not silently replan.</small>
                </div>
                <div>
                  <button className="button" type="button" disabled={!canEdit || Boolean(busy)} onClick={() => void generateAlternatives()}>{busy === "alternatives" ? <FiRefreshCw aria-hidden /> : <FiGitBranch aria-hidden />} Compare alternatives</button>
                  <button className="button button-primary" type="button" disabled={!canEdit || Boolean(busy) || draftDirty || Boolean(activeRender)} onClick={() => void approveRender()}>{busy === "render" || activeRender ? <FiRefreshCw aria-hidden /> : <FiPlay aria-hidden />} Approve & render</button>
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {comparisonIds.length ? (
        <section className={styles.comparison}>
          <div className={styles.comparisonHeading}>
            <div><span className="section-label">03 / Alternatives</span><h3>Same brief. Three legal interpretations.</h3></div>
            <p>All variants keep the same hard locks and safety invariants. The difference is how the planner ranks otherwise valid routes.</p>
          </div>
          <div className={styles.comparisonGrid}>
            {comparisonIds.map((id) => {
              const job = comparisonJobs.find((item) => item.id === id);
              const plan = planFromJob(job);
              const optionVariant = variantFromPlan(plan);
              return (
                <article key={id} className={id === currentJobId ? styles.comparisonActive : ""}>
                  <span className="section-label">{optionVariant}</span>
                  <h4>{job ? statusLabel(job.status) : "Queued"}</h4>
                  <div className={styles.comparisonFacts}>
                    <span><small>Confidence</small><strong>{percent(plan?.quality_summary?.mean_confidence)}</strong></span>
                    <span><small>Risky handoffs</small><strong>{plan?.quality_summary?.risky_transition_count ?? "—"}</strong></span>
                    <span><small>Duration</small><strong>{formatDuration(plan?.estimated_duration_ms)}</strong></span>
                  </div>
                  <p>{plan?.tracks?.map((track) => track.title).filter(Boolean).slice(0, 5).join(" → ") || "Set Intelligence is evaluating this route…"}</p>
                  <button className="button" type="button" disabled={!job || job.status !== "completed"} onClick={() => job && setCurrentJobId(job.id)}>Open this plan</button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {latestRender ? (
        <section className={styles.renderStatus}>
          <div>
            <span className="section-label">Approved performance</span>
            <h3>{ACTIVE.has(latestRender.status) ? "Rendering the frozen MixPlan." : latestRender.status === "completed" ? "The approved mix is ready." : "Approved render needs attention."}</h3>
            <p>{latestRender.error || "The renderer is executing the approved source windows, transitions and automation without replanning."}</p>
          </div>
          <div className={styles.renderAction}>
            <strong>{statusLabel(latestRender.status)}</strong>
            {latestRender.output?.public_url ? <a className="button button-primary" href={latestRender.output.public_url} target="_blank" rel="noreferrer">Open rendered mix</a> : null}
          </div>
        </section>
      ) : null}
    </section>
  );
}
