"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createActiveMaster, promoteActiveMaster } from "@/app/studio/mastering-actions";
import { MasteringABPlayer } from "@/components/studio/mastering-ab-player";
import { MasteringAnalysisReport } from "@/components/studio/mastering-analysis-report";
import { ProcessingState } from "@/components/studio/processing-state";
import { ConfirmButton, SubmitButton } from "@/components/studio/submit-button";
import type { Json } from "@/types/database";
import styles from "./active-mastering-panel.module.css";

type Job = {
  id: string;
  preset: "balanced" | "punchy" | "dynamic";
  status: "planned" | "queued" | "running" | "completed" | "failed" | "cancelled";
  error: string | null;
  createdAt: string;
  outputUrl: string | null;
  result: Json;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metric(value: number | null, suffix: string, digits = 1) {
  return value === null ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function title(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const presets = [
  { id: "balanced", title: "Balanced", copy: "Clean, controlled and release-ready without chasing loudness." },
  { id: "punchy", title: "Punchy", copy: "More forward impact when the source still has dynamic headroom." },
  { id: "dynamic", title: "Dynamic", copy: "Preserve movement and transients with the lightest dynamics processing." },
] as const;

export function ActiveMasteringControls({
  artistId,
  trackId,
  sourceAudioUrl,
  jobs,
}: {
  artistId: string;
  trackId: string;
  sourceAudioUrl: string | null;
  jobs: Job[];
}) {
  const router = useRouter();
  const [displayJobs, setDisplayJobs] = useState(jobs);
  const [pollError, setPollError] = useState("");
  const hasActive = displayJobs.some((job) => ["planned", "queued", "running"].includes(job.status));

  useEffect(() => setDisplayJobs(jobs), [jobs]);

  const refreshJobs = useCallback(async () => {
    const params = new URLSearchParams({ artist: artistId, track: trackId });
    const response = await fetch(`/api/studio/mastering/jobs?${params.toString()}`, { cache: "no-store" });
    const body = await response.json().catch(() => null) as { jobs?: Job[]; error?: string } | null;
    if (!response.ok || !body?.jobs) throw new Error(body?.error || "Could not refresh mastering runs.");
    setDisplayJobs(body.jobs);
    setPollError("");
  }, [artistId, trackId]);

  useEffect(() => {
    if (!hasActive) return;
    let cancelled = false;
    async function poll() {
      if (cancelled || document.visibilityState === "hidden") return;
      try {
        await refreshJobs();
      } catch {
        if (!cancelled) setPollError("Live mastering status is temporarily unavailable. The render itself can continue in the background queue.");
      }
    }
    const timer = window.setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasActive, refreshJobs]);

  async function createCandidate(formData: FormData) {
    await createActiveMaster(formData);
    await refreshJobs().catch(() => router.refresh());
  }

  async function promoteCandidate(formData: FormData) {
    await promoteActiveMaster(formData);
    router.refresh();
  }

  const completed = displayJobs.filter((job) => job.status === "completed" && job.outputUrl);
  const latestActive = displayJobs.find((job) => ["planned", "queued", "running"].includes(job.status));
  const failed = displayJobs.find((job) => job.status === "failed");
  const activePreset = latestActive ? title(latestActive.preset) : null;

  return (
    <section className={styles.root} aria-label="Active Mastering">
      <header className={styles.header}>
        <div>
          <span className="section-label">Active Mastering</span>
          <h3>Improve the master, then verify the result</h3>
          <p>Ensemblis uses a constrained DSP chain, re-measures the rendered waveform and keeps the original master untouched.</p>
        </div>
        {latestActive ? <span className={styles.running}>{latestActive.status === "running" ? "Mastering…" : "Queued"}</span> : null}
      </header>

      {latestActive ? (
        <ProcessingState
          className={styles.processing}
          compact
          eyebrow={`${activePreset} master`}
          title={latestActive.status === "running" ? "Shaping the candidate" : "Preparing the mastering chain"}
          detail={latestActive.status === "running"
            ? "Rendering with constrained DSP, then measuring loudness, peak safety and preserved dynamics before the candidate is shown."
            : "The source is queued. Ensemblis will keep the original untouched and move directly into verification after render."}
          steps={[
            { label: "Source protected", state: "complete" },
            { label: "Render", state: latestActive.status === "running" ? "active" : "waiting" },
            { label: "Measure", state: "waiting" },
            { label: "Verify", state: "waiting" },
          ]}
        />
      ) : (
        <div className={styles.presets}>
          {presets.map((preset, index) => (
            <form action={createCandidate} className={styles.preset} key={preset.id}>
              <input type="hidden" name="track_id" value={trackId} />
              <input type="hidden" name="preset" value={preset.id} />
              <span className={styles.presetIndex}>0{index + 1}</span>
              <strong>{preset.title}</strong>
              <p>{preset.copy}</p>
              <SubmitButton className="button" pendingLabel={`Creating ${preset.title.toLowerCase()} master…`} disabled={!sourceAudioUrl}>
                Create {preset.title} master
              </SubmitButton>
            </form>
          ))}
        </div>
      )}

      {pollError ? <div className={styles.error} role="status"><strong>Live status paused.</strong><p>{pollError}</p><button type="button" className="text-button" onClick={() => void refreshJobs()}>Retry status</button></div> : null}

      {failed ? (
        <div className={styles.error} role="alert">
          <strong>The last mastering attempt needs attention.</strong>
          <p>{failed.error || "The mastering worker could not complete the render. Choose a preset above to retry from the untouched source."}</p>
        </div>
      ) : null}

      {completed.length ? (
        <div className={styles.candidates}>
          {completed.map((job) => {
            const result = record(job.result);
            const before = record(result.before);
            const after = record(result.after);
            const beforeLoudness = record(before.loudness);
            const afterLoudness = record(after.loudness);
            const beforeDynamics = record(before.dynamics);
            const afterDynamics = record(after.dynamics);
            const checks = record(result.final_checks);
            const iterations = Array.isArray(result.iterations) ? result.iterations.length : 0;
            const beforeIntegrated = number(beforeLoudness.integrated_lufs);
            const afterIntegrated = number(afterLoudness.integrated_lufs);
            return (
              <article className={styles.candidate} key={job.id}>
                <div className={styles.candidateHead}>
                  <div>
                    <span>{title(job.preset)} candidate</span>
                    <strong>{checks.pass === true ? "Verified master" : "Review candidate"}</strong>
                  </div>
                  <small>{iterations} render pass{iterations === 1 ? "" : "es"}</small>
                </div>

                <div className={styles.metrics}>
                  <div><span>Integrated</span><strong>{metric(beforeIntegrated, " LUFS")}</strong><b>→</b><strong>{metric(afterIntegrated, " LUFS")}</strong></div>
                  <div><span>True peak</span><strong>{metric(number(beforeLoudness.true_peak_dbtp), " dBTP", 2)}</strong><b>→</b><strong>{metric(number(afterLoudness.true_peak_dbtp), " dBTP", 2)}</strong></div>
                  <div><span>PLR</span><strong>{metric(number(beforeDynamics.peak_to_loudness_ratio_lu), " LU")}</strong><b>→</b><strong>{metric(number(afterDynamics.peak_to_loudness_ratio_lu), " LU")}</strong></div>
                </div>

                {sourceAudioUrl && job.outputUrl ? (
                  <MasteringABPlayer
                    originalUrl={sourceAudioUrl}
                    masteredUrl={job.outputUrl}
                    originalLufs={beforeIntegrated}
                    masteredLufs={afterIntegrated}
                  />
                ) : null}

                <details className="mastering-report-disclosure">
                  <summary>Full verification report</summary>
                  <p className="v2-muted-copy">Every measured mastering result is translated into readable evidence here; no analysis is hidden behind a raw JSON payload.</p>
                  <MasteringAnalysisReport result={job.result} />
                </details>

                <div className={styles.actions}>
                  <div className={styles.actionButtons}>
                    <a className="button" href={job.outputUrl || "#"} download>Download 24-bit WAV</a>
                    {checks.pass === true ? (
                      <form action={promoteCandidate}>
                        <input type="hidden" name="job_id" value={job.id} />
                        <ConfirmButton
                          className="button primary"
                          confirmClassName="button primary"
                          title="Use this verified master?"
                          message="This will make the rendered candidate the canonical master for the track and trigger fresh Track Intelligence from that audio. The previous source remains in media history."
                          confirmLabel="Use as canonical master"
                          pendingLabel="Promoting master…"
                        >
                          Use as canonical master
                        </ConfirmButton>
                      </form>
                    ) : null}
                  </div>
                  <span>{checks.true_peak_safe === true ? "True peak safe" : "Check true peak"} · {checks.dynamics_preserved === true ? "Dynamics preserved" : "Review dynamics"}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
