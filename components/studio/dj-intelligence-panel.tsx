"use client";

import { useCallback, useEffect, useState } from "react";
import { FiRefreshCw, FiSave, FiSliders, FiThumbsDown, FiThumbsUp } from "react-icons/fi";
import styles from "./dj-intelligence-panel.module.css";

type Preferences = {
  enabled: boolean;
  harmonicAdventure: number;
  transitionAggressiveness: number;
  exploration: number;
};

type JobSummary = {
  id: string;
  name: string;
  status: string;
  result_payload: unknown;
};

const DEFAULTS: Preferences = {
  enabled: true,
  harmonicAdventure: 0.5,
  transitionAggressiveness: 0.5,
  exploration: 0.45,
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

export function DjIntelligencePanel({ artistId }: { artistId: string }) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [learnedConfidence, setLearnedConfidence] = useState(0);
  const [evidenceCount, setEvidenceCount] = useState(0);
  const [latestJob, setLatestJob] = useState<JobSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const [profileResponse, jobsResponse] = await Promise.all([
        fetch(`/api/studio/automix/preferences?artist=${encodeURIComponent(artistId)}`, { cache: "no-store" }),
        fetch(`/api/studio/automix?artist=${encodeURIComponent(artistId)}`, { cache: "no-store" }),
      ]);
      const profileBody = await profileResponse.json().catch(() => null);
      const jobsBody = await jobsResponse.json().catch(() => null);
      if (!profileResponse.ok) throw new Error(String(record(profileBody).error || "Could not load DJ preferences."));
      if (!jobsResponse.ok) throw new Error(String(record(jobsBody).error || "Could not load AutoMix sessions."));
      setPreferences(asPreferences(record(profileBody).preferences));
      setLearnedConfidence(Number(record(profileBody).learnedConfidence || 0));
      setEvidenceCount(Number(record(profileBody).evidenceCount || 0));
      const jobs = Array.isArray(record(jobsBody).jobs) ? record(jobsBody).jobs as JobSummary[] : [];
      setLatestJob(jobs.find((job) => job.status === "completed" && planFromJob(job)) ?? null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load Personal DJ Intelligence.");
    } finally {
      setLoading(false);
    }
  }, [artistId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updatePreference(key: keyof Omit<Preferences, "enabled">, percent: number) {
    setPreferences((current) => ({ ...current, [key]: percent / 100 }));
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
      setStatus("DJ profile saved. New AutoMix sessions will use this profile as a bounded planning signal.");
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
        ? "Saved. Ensemblis can use this approved plan as bounded evidence for future set planning."
        : "Saved. This plan will not count as positive learning evidence.");
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
    { key: "transitionAggressiveness", title: "Transition character", detail: "A bounded preference layered on top of AutoMix safety, never a permission to force a bad blend.", low: "restrained", middle: "DJ", high: "creative" },
    { key: "exploration", title: "Exploration", detail: "How readily Set Intelligence should choose less-obvious candidates from the pool you provide.", low: "familiar", middle: "open", high: "explore" },
  ];

  return (
    <section className={styles.panel} aria-label="Personal DJ Intelligence">
      <div className={styles.intro}>
        <span className="section-label">DJ & Mixes / Intelligence</span>
        <h2>Your taste, not a generic playlist.</h2>
        <p>
          Ensemblis can treat your selected records as a candidate pool, curate for the target duration,
          then hand the chosen route to the same verified AutoMix planner and renderer.
        </p>
      </div>

      <div className={styles.body}>
        <div className={styles.profileHeader}>
          <div>
            <strong>Personal DJ profile</strong>
            <small>
              {evidenceCount} plan signal{evidenceCount === 1 ? "" : "s"} · learning confidence {Math.round(learnedConfidence * 100)}% · automatic nudge never exceeds ±5 points
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
            const percent = Math.round(value * 100);
            return (
              <label className={styles.control} key={control.key}>
                <span className={styles.controlCopy}>
                  <strong>{control.title}</strong>
                  <small>{control.detail}</small>
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
            <span className="section-label">Bounded learning</span>
            <strong>Explicit choices stay authoritative.</strong>
            <small>
              Approved mixes can make only a small bounded adjustment to your direct settings. They cannot override BPM safety,
              vocal/bass collision vetoes, source quality checks, stretch limits or your explicit preferences.
            </small>
          </div>
          <div className={styles.actions}>
            <button className="button" type="button" disabled={loading} onClick={() => void load()}><FiRefreshCw /> Refresh</button>
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
          <p className={styles.note}>Only a positive “this feels like me” signal contributes to learned preferences. A rejection is stored as inspectable evidence without guessing what you disliked.</p>
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
