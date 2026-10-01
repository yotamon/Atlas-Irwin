"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createActiveMaster, promoteActiveMaster } from "@/app/studio/mastering-actions";
import { MasteringListenLab } from "@/components/studio/mastering-listen-lab";
import { MasteringAnalysisReport } from "@/components/studio/mastering-analysis-report";
import { ProcessingState } from "@/components/studio/processing-state";
import { ConfirmButton, SubmitButton } from "@/components/studio/submit-button";
import type { MasterReadiness } from "@/lib/mastering/readiness";
import type { Json } from "@/types/database";
import styles from "./active-mastering-panel.module.css";

type Job = {
  id: string;
  preset: "streaming_safe" | "balanced" | "punchy" | "dynamic";
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
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function outputFormatLabel(value: Json) {
  const output = record(record(value).output);
  const container = typeof output.container === "string" && output.container.trim()
    ? output.container.trim().toUpperCase()
    : "lossless master";
  const bitDepth = number(output.bit_depth);
  return `${bitDepth ? `${Math.round(bitDepth)}-bit ` : ""}${container}`;
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
  readiness,
  references,
}: {
  artistId: string;
  trackId: string;
  sourceAudioUrl: string | null;
  jobs: Job[];
  readiness: MasterReadiness;
  references: Array<{ label: string; url: string; lufs: number | null }>;
}) {
  const router = useRouter();
  const [refreshedJobs, setRefreshedJobs] = useState<{ trackId: string; jobs: Job[] } | null>(null);
  const [pollError, setPollError] = useState("");
  const displayJobs = refreshedJobs?.trackId === trackId ? refreshedJobs.jobs : jobs;
  const hasActive = displayJobs.some((job) => ["planned", "queued", "running"].includes(job.status));

  const refreshJobs = useCallback(async () => {
    const params = new URLSearchParams({ artist: artistId, track: trackId });
    const response = await fetch(`/api/studio/mastering/jobs?${params.toString()}`, { cache: "no-store" });
    const body = await response.json().catch(() => null) as { jobs?: Job[]; error?: string } | null;
    if (!response.ok || !body?.jobs) throw new Error(body?.error || "Could not refresh mastering runs.");
    setRefreshedJobs({ trackId, jobs: body.jobs });
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
    await refreshJobs().catch(() => {
      setRefreshedJobs(null);
      router.refresh();
    });
  }

  async function promoteCandidate(formData: FormData) {
    await promoteActiveMaster(formData);
    setRefreshedJobs(null);
    router.refresh();
  }

  const completed = displayJobs.filter((job) => job.status === "completed" && job.outputUrl);
  const latestActive = displayJobs.find((job) => ["planned", "queued", "running"].includes(job.status));
  const failed = displayJobs.find((job) => job.status === "failed");
  const activePreset = latestActive ? title(latestActive.preset) : null;
  const masteringRecommended = readiness.primaryAction === "mastering_fix";
  const sourceRepairRequired = readiness.status === "fix_required" && !readiness.findings.some((finding) => finding.masteringCanHelp);

  return (
    <section className={styles.root} id="active-mastering" aria-label="Mastering options">
      <header className={styles.header}>
        <div>
          <span className="section-label">{latestActive ? "Mastering candidate" : "Optional mastering"}</span>
          <h3>{latestActive ? "Ensemblis is preparing a verified alternative" : masteringRecommended ? "Add streaming headroom without changing the character" : sourceRepairRequired ? "Mastering is not the right fix for this blocker" : readiness.status === "ready" ? "The current master does not need corrective mastering" : "Master only when you want a deliberate change"}</h3>
          <p>{latestActive
            ? "The original stays untouched. Ensemblis will re-measure the rendered waveform before it can be approved."
            : masteringRecommended
              ? "The source-preserving path keeps loudness, tone and dynamics as close as possible while creating safer true-peak and codec headroom."
              : sourceRepairRequired
                ? "Repair or replace the source first. Ensemblis will not present mastering as a cure for clipping, phase, timing or render problems it cannot safely restore."
                : "Balanced, Punchy and Dynamic remain available as creative directions, but they are never required just because the tools exist."}</p>
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
        <>
          {masteringRecommended ? (
            <form action={createCandidate} className={styles.recommended}>
              <input type="hidden" name="track_id" value={trackId} />
              <input type="hidden" name="preset" value="streaming_safe" />
              <div>
                <span className="section-label">Recommended fix</span>
                <strong>Streaming-safe master</strong>
                <p>Preserve the current balance and dynamics while applying only the minimum transparent level reduction needed for safer true-peak and codec headroom.</p>
              </div>
              <SubmitButton className="button primary" pendingLabel="Creating streaming-safe master…" disabled={!sourceAudioUrl}>
                Create streaming-safe master
              </SubmitButton>
            </form>
          ) : (
            <div className={styles.calm}>
              <strong>{sourceRepairRequired ? "Fix the source before creating a new master." : readiness.status === "ready" ? "Keep the current master unless you want a creative change." : "Listen to the findings before deciding whether to change the sound."}</strong>
              <span>{sourceRepairRequired ? "A mastering render could hide symptoms without repairing the underlying audio." : "The original remains the canonical master until you explicitly approve a verified candidate."}</span>
            </div>
          )}

          <details className={styles.directions}>
            <summary>Explore a different mastering direction</summary>
            <p>These are creative alternatives, not release requirements. Compare them at matched loudness before choosing.</p>
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
          </details>
        </>
      )}

      {pollError ? <div className={styles.error} role="status"><strong>Live status paused.</strong><p>{pollError}</p><button type="button" className="text-button" onClick={() => void refreshJobs()}>Retry status</button></div> : null}

      {failed ? (
        <div className={styles.error} role="alert">
          <strong>The last mastering attempt needs attention.</strong>
          <p>{failed.error || "The mastering worker could not complete the render. The untouched source remains canonical and safe to retry."}</p>
          {!hasActive ? (
            <form action={createCandidate}>
              <input type="hidden" name="track_id" value={trackId} />
              <input type="hidden" name="preset" value={failed.preset} />
              <SubmitButton className="button" pendingLabel="Retrying mastering…" disabled={!sourceAudioUrl}>
                Retry {failed.preset === "streaming_safe" ? "streaming-safe master" : `${title(failed.preset)} master`}
              </SubmitButton>
            </form>
          ) : null}
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
            const downloadLabel = outputFormatLabel(job.result);
            const beforeIntegrated = number(beforeLoudness.integrated_lufs);
            const afterIntegrated = number(afterLoudness.integrated_lufs);
            return (
              <article className={styles.candidate} key={job.id}>
                <div className={styles.candidateHead}>
                  <div>
                    <span>{job.preset === "streaming_safe" ? "Streaming-safe candidate" : `${title(job.preset)} candidate`}</span>
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
                  <MasteringListenLab
                    originalUrl={sourceAudioUrl}
                    candidateUrl={job.outputUrl}
                    originalLufs={beforeIntegrated}
                    candidateLufs={afterIntegrated}
                    references={references}
                  />
                ) : null}

                <details className="mastering-report-disclosure">
                  <summary>Full verification report</summary>
                  <p className="v2-muted-copy">Every measured mastering result is translated into readable evidence here; no analysis is hidden behind a raw JSON payload.</p>
                  <MasteringAnalysisReport result={job.result} />
                </details>

                <div className={styles.actions}>
                  <div className={styles.actionButtons}>
                    <a className="button" href={job.outputUrl || "#"} download>Download {downloadLabel}</a>
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
