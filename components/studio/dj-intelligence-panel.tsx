"use client";

import { useEffect, useRef, useState } from "react";
import { FiRefreshCw, FiSave, FiSliders, FiThumbsDown, FiThumbsUp } from "react-icons/fi";
import styles from "./dj-intelligence-panel.module.css";

type Preferences = {
  enabled: boolean;
  harmonicAdventure: number;
  transitionAggressiveness: number;
  exploration: number;
  tempoMovement: number;
  energyDynamics: number;
};

type JobSummary = {
  id: string;
  name: string;
  status: string;
  result_payload: unknown;
};

type IntelligenceSnapshot = {
  preferences: Preferences;
  learnedPreferences: Preferences;
  learnedConfidence: number;
  evidenceCount: number;
  latestJob: JobSummary | null;
};

const DEFAULTS: Preferences = {
  enabled: true,
  harmonicAdventure: 0.5,
  transitionAggressiveness: 0.5,
  exploration: 0.45,
  tempoMovement: 0.42,
  energyDynamics: 0.52,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asPreferences(value: unknown): Preferences {
  const raw = record(value);
  const number = (key: keyof Preferences, fallback: number) => {
    const value = raw[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  };
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULTS.enabled,
    harmonicAdventure: number("harmonicAdventure", DEFAULTS.harmonicAdventure),
    transitionAggressiveness: number("transitionAggressiveness", DEFAULTS.transitionAggressiveness),
    exploration: number("exploration", DEFAULTS.exploration),
    tempoMovement: number("tempoMovement", DEFAULTS.tempoMovement),
    energyDynamics: number("energyDynamics", DEFAULTS.energyDynamics),
  };
}

function band(value: number, low: string, middle: string, high: string) {
  if (value < 0.34) return low;
  if (value > 0.67) return high;
  return middle;
}

function planFromJob(job: JobSummary) {
  const plan = record(record(job.result_payload).plan);
  return Object.keys(plan).length ? plan : null;
}

async function fetchIntelligenceSnapshot(artistId: string, signal?: AbortSignal): Promise<IntelligenceSnapshot> {
  const [profileResponse, jobsResponse] = await Promise.all([
    fetch(`/api/studio/automix/preferences?artist=${encodeURIComponent(artistId)}`, { cache: "no-store", signal }),
    fetch(`/api/studio/automix?artist=${encodeURIComponent(artistId)}`, { cache: "no-store", signal }),
  ]);
  const profileBody = await profileResponse.json().catch(() => null);
  const jobsBody = await jobsResponse.json().catch(() => null);
  if (!profileResponse.ok) throw new Error(String(record(profileBody).error || "Could not load DJ preferences."));
  if (!jobsResponse.ok) throw new Error(String(record(jobsBody).error || "Could not load AutoMix sessions."));
  const jobs = Array.isArray(record(jobsBody).jobs) ? record(jobsBody).jobs as JobSummary[] : [];
  return {
    preferences: asPreferences(record(profileBody).preferences),
    learnedPreferences: asPreferences(record(profileBody).learnedPreferences),
    learnedConfidence: Number(record(profileBody).learnedConfidence || 0),
    evidenceCount: Number(record(profileBody).evidenceCount || 0),
    latestJob: jobs.find((job) => job.status === "completed" && planFromJob(job)) ?? null,
  };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function DjIntelligencePanel({ artistId }: { artistId: string }) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [learnedPreferences, setLearnedPreferences] = useState<Preferences>(DEFAULTS);
  const [learnedConfidence, setLearnedConfidence] = useState(0);
  const [evidenceCount, setEvidenceCount] = useState(0);
  const [latestJob, setLatestJob] = useState<JobSummary | null>(null);
  const [loadedArtistId, setLoadedArtistId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [status, setStatus] = useState("");
  const currentArtistId = useRef(artistId);
  const loading = loadedArtistId !== artistId || refreshing;

  useEffect(() => {
    currentArtistId.current = artistId;
  }, [artistId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchIntelligenceSnapshot(artistId, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        setPreferences(snapshot.preferences);
        setLearnedPreferences(snapshot.learnedPreferences);
        setLearnedConfidence(snapshot.learnedConfidence);
        setEvidenceCount(snapshot.evidenceCount);
        setLatestJob(snapshot.latestJob);
        setStatus("");
        setLoadedArtistId(artistId);
      })
      .catch((error) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setStatus(error instanceof Error ? error.message : "Could not load Personal DJ Intelligence.");
        setLoadedArtistId(artistId);
      });
    return () => controller.abort();
  }, [artistId]);

  function updatePreference(key: keyof Omit<Preferences, "enabled">, percent: number) {
    setPreferences((current) => ({ ...current, [key]: percent / 100 }));
  }

  async function refresh() {
    if (refreshing) return;
    const requestedArtistId = artistId;
    setRefreshing(true);
    setStatus("");
    try {
      const snapshot = await fetchIntelligenceSnapshot(requestedArtistId);
      if (currentArtistId.current !== requestedArtistId) return;
      setPreferences(snapshot.preferences);
      setLearnedPreferences(snapshot.learnedPreferences);
      setLearnedConfidence(snapshot.learnedConfidence);
      setEvidenceCount(snapshot.evidenceCount);
      setLatestJob(snapshot.latestJob);
      setLoadedArtistId(requestedArtistId);
    } catch (error) {
      if (currentArtistId.current !== requestedArtistId) return;
      setStatus(error instanceof Error ? error.message : "Could not load Personal DJ Intelligence.");
    } finally {
      if (currentArtistId.current === requestedArtistId) setRefreshing(false);
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/studio/automix/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artistId, preferences }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(record(body).error || "Could not save DJ preferences."));
      setPreferences(asPreferences(record(body).preferences));
      setLearnedPreferences(asPreferences(record(body).learnedPreferences));
      setLearnedConfidence(Number(record(body).learnedConfidence || learnedConfidence));
      setEvidenceCount(Number(record(body).evidenceCount || evidenceCount));
      setStatus("DJ profile saved. New Set Builder revisions will use it only as a bounded reranking signal.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save DJ preferences.");
    } finally {
      setSaving(false);
    }
  }

  async function sendFeedback(verdict: "accepted" | "rejected") {
    if (!latestJob || feedbackSaving) return;
    setFeedbackSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/studio/automix/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artistId, jobId: latestJob.id, verdict }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(record(body).error || "Could not save DJ-plan feedback."));
      setLearnedConfidence(Number(record(body).learnedConfidence || 0));
      setEvidenceCount(Number(record(body).evidenceCount || 0));
      setStatus(verdict === "accepted"
        ? "Saved. This whole-plan judgement joins your Set Builder edits and approved renders as bounded learning evidence."
        : "Saved. The rejection stays inspectable, but Ensemblis will not guess which musical dimension you disliked.");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save DJ-plan feedback.");
    } finally {
      setFeedbackSaving(false);
    }
  }

  const controls: Array<{
    key: keyof Omit<Preferences, "enabled">;
    title: string;
    detail: string;
    low: string;
    middle: string;
    high: string;
  }> = [
    { key: "harmonicAdventure", title: "Harmonic adventure", detail: "How much controlled key contrast you enjoy when the transition remains musically safe.", low: "safe", middle: "balanced", high: "adventurous" },
    { key: "transitionAggressiveness", title: "Transition character", detail: "A bounded preference layered on top of AutoMix safety, never permission to force a bad blend.", low: "restrained", middle: "DJ", high: "creative" },
    { key: "exploration", title: "Exploration", detail: "How readily Set Intelligence should choose less-obvious candidates from the pool you provide.", low: "familiar", middle: "open", high: "explore" },
    { key: "tempoMovement", title: "Tempo movement", detail: "Whether otherwise-valid routes should stay tightly grouped in BPM or travel more between tempo territories.", low: "steady", middle: "moving", high: "wide" },
    { key: "energyDynamics", title: "Energy contrast", detail: "How much adjacent-track energy contrast you enjoy while the global purpose and arc remain authoritative.", low: "smooth", middle: "dynamic", high: "dramatic" },
  ];

  return (
    <section className={styles.panel} aria-label="Personal DJ Intelligence">
      <div className={styles.intro}>
        <span className="section-label">DJ & Mixes / Intelligence</span>
        <h2>Your taste, not a generic playlist.</h2>
        <p>
          Ensemblis learns from deliberate Set Builder decisions, not passive clicks: what you lock, reorder,
          replace, override and finally approve becomes bounded evidence for future planning.
        </p>
      </div>

      <div className={styles.body}>
        <div className={styles.profileHeader}>
          <div>
            <strong>Personal DJ profile v2</strong>
            <small>
              {evidenceCount} decision signal{evidenceCount === 1 ? "" : "s"} · learning confidence {Math.round(learnedConfidence * 100)}% · effective automatic nudge stays below ±5 points
            </small>
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={preferences.enabled}
              onChange={(event) => setPreferences((current) => ({ ...current, enabled: event.target.checked }))}
            />
            Use my profile
          </label>
        </div>

        <div className={styles.controls} aria-disabled={!preferences.enabled}>
          {controls.map((control) => {
            const value = preferences[control.key];
            const learned = learnedPreferences[control.key];
            const percent = Math.round(value * 100);
            return (
              <label className={styles.control} key={control.key}>
                <span className={styles.controlCopy}>
                  <strong>{control.title}</strong>
                  <small>{control.detail}</small>
                  <small>Learned tendency: {Math.round(learned * 100)} · {band(learned, control.low, control.middle, control.high)}</small>
                </span>
                <span className={styles.rangeWrap}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={percent}
                    disabled={!preferences.enabled}
                    onChange={(event) => updatePreference(control.key, Number(event.target.value))}
                  />
                  <span className={styles.value}>{percent} · {band(value, control.low, control.middle, control.high)}</span>
                </span>
              </label>
            );
          })}
        </div>

        <div className={styles.learning}>
          <div className={styles.learningCopy}>
            <span className="section-label">Inspectable bounded learning</span>
            <strong>Explicit choices stay authoritative.</strong>
            <small>
              Completed edits and approved renders build confidence gradually. Learned tendencies only rerank otherwise valid candidates;
              they cannot override BPM safety, vocal/bass collision vetoes, source quality checks, stretch limits, hard locks or transition validation.
            </small>
          </div>
          <div className={styles.actions}>
            <button className="button" type="button" disabled={loading} onClick={() => void refresh()}><FiRefreshCw /> Refresh</button>
            <button className="button primary" type="button" disabled={loading || saving} onClick={() => void save()}><FiSave /> {saving ? "Saving…" : "Save profile"}</button>
          </div>
        </div>

        <div className={styles.feedback}>
          <div className={styles.feedbackTitle}>
            <div>
              <span>Latest completed plan</span>
              <strong>{latestJob?.name ?? "No completed AutoMix plan yet"}</strong>
            </div>
            <FiSliders aria-hidden />
          </div>
          <p className={styles.note}>Whole-plan feedback is optional. Your concrete Set Builder edits and approved renders are already stronger evidence. A rejection is stored without guessing why.</p>
          <div className={styles.feedbackActions}>
            <button className="button" type="button" disabled={!latestJob || feedbackSaving} onClick={() => void sendFeedback("accepted")}><FiThumbsUp /> This feels like me</button>
            <button className="button" type="button" disabled={!latestJob || feedbackSaving} onClick={() => void sendFeedback("rejected")}><FiThumbsDown /> Not my direction</button>
          </div>
        </div>

        <div className={styles.status} role="status">{loading ? "Reading your DJ profile…" : status}</div>
      </div>
    </section>
  );
}
