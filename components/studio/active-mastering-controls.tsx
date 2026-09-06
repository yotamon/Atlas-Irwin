"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createActiveMaster, promoteActiveMaster } from "@/app/studio/mastering-actions";
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
  trackId,
  sourceAudioUrl,
  jobs,
}: {
  trackId: string;
  sourceAudioUrl: string | null;
  jobs: Job[];
}) {
  const router = useRouter();
  const hasActive = jobs.some((job) => ["planned", "queued", "running"].includes(job.status));

  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => router.refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [hasActive, router]);

  async function createCandidate(formData: FormData) {
    await createActiveMaster(formData);
    router.refresh();
  }

  async function promoteCandidate(formData: FormData) {
    await promoteActiveMaster(formData);
    router.refresh();
  }

  const completed = jobs.filter((job) => job.status === "completed" && job.outputUrl);
  const latestActive = jobs.find((job) => ["planned", "queued", "running"].includes(job.status));

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

      <div className={styles.presets}>
        {presets.map((preset) => (
          <form action={createCandidate} className={styles.preset} key={preset.id}>
            <input type="hidden" name="track_id" value={trackId} />
            <input type="hidden" name="preset" value={preset.id} />
            <strong>{preset.title}</strong>
            <p>{preset.copy}</p>
            <button className="button" type="submit" disabled={!sourceAudioUrl || hasActive}>
              {hasActive ? "Mastering in progress" : `Create ${preset.title} master`}
            </button>
          </form>
        ))}
      </div>

      {jobs.some((job) => job.status === "failed") ? (
        <div className={styles.error}>
          <strong>The last mastering attempt needs attention.</strong>
          <p>{jobs.find((job) => job.status === "failed")?.error || "The worker could not complete the render."}</p>
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
                  <div><span>Integrated</span><strong>{metric(number(beforeLoudness.integrated_lufs), " LUFS")}</strong><b>→</b><strong>{metric(number(afterLoudness.integrated_lufs), " LUFS")}</strong></div>
                  <div><span>True peak</span><strong>{metric(number(beforeLoudness.true_peak_dbtp), " dBTP", 2)}</strong><b>→</b><strong>{metric(number(afterLoudness.true_peak_dbtp), " dBTP", 2)}</strong></div>
                  <div><span>PLR</span><strong>{metric(number(beforeDynamics.peak_to_loudness_ratio_lu), " LU")}</strong><b>→</b><strong>{metric(number(afterDynamics.peak_to_loudness_ratio_lu), " LU")}</strong></div>
                </div>
                <div className={styles.ab}>
                  {sourceAudioUrl ? <label><span>Original</span><audio controls preload="metadata" src={sourceAudioUrl} /></label> : null}
                  <label><span>Mastered</span><audio controls preload="metadata" src={job.outputUrl || undefined} /></label>
                </div>
                <div className={styles.actions}>
                  <div className={styles.actionButtons}>
                    <a className="button" href={job.outputUrl || "#"} download>Download 24-bit WAV</a>
                    {checks.pass === true ? (
                      <form action={promoteCandidate}>
                        <input type="hidden" name="job_id" value={job.id} />
                        <button className="button primary" type="submit">Use as canonical master</button>
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
