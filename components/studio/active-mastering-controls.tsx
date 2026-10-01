"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createActiveMaster, keepOriginalMaster, promoteActiveMaster } from "@/app/studio/mastering-actions";
import { MasteringListenLab, type MasteringCodecPreview, type MasteringSuggestedLoop } from "@/components/studio/mastering-listen-lab";
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

function masteringSuggestedLoops(value: Json): MasteringSuggestedLoop[] {
  const result = record(value);
  const after = record(result.after);
  const loops: MasteringSuggestedLoop[] = [];

  const peaks = record(after.peaks);
  const peakMs = number(peaks.sample_peak_ms);
  if (peakMs !== null) {
    const center = peakMs / 1000;
    const start = Math.max(0, center - 4);
    loops.push({
      label: "Peak / transient stress",
      start,
      end: start + 12,
      reason: "Audition the area around the candidate's measured peak and strongest limiter stress.",
    });
  }

  const stereoTimeline = Array.isArray(after.stereo_timeline)
    ? after.stereo_timeline.map(record)
    : [];
  const monoSensitive = stereoTimeline
    .map((row) => ({
      startMs: number(row.start_ms),
      endMs: number(row.end_ms),
      mono: number(row.mono_fold_down_delta_db),
    }))
    .filter((row) => row.startMs !== null && row.endMs !== null && row.mono !== null)
    .sort((a, b) => Number(a.mono) - Number(b.mono))[0];
  if (monoSensitive && monoSensitive.startMs !== null && monoSensitive.endMs !== null) {
    loops.push({
      label: "Mono-sensitive moment",
      start: monoSensitive.startMs / 1000,
      end: Math.max(monoSensitive.startMs / 1000 + 4, monoSensitive.endMs / 1000),
      reason: "This window has the largest measured mono fold-down loss in the candidate.",
    });
  }

  const stability = record(after.temporal_stability);
  const findings = Array.isArray(stability.findings) ? stability.findings.map(record) : [];
  const localized = findings.find((finding) => number(finding.start_ms) !== null && number(finding.end_ms) !== null);
  const findingStart = localized ? number(localized.start_ms) : null;
  const findingEnd = localized ? number(localized.end_ms) : null;
  if (localized && findingStart !== null && findingEnd !== null) {
    loops.push({
      label: "Render-change finding",
      start: findingStart / 1000,
      end: Math.min(findingStart / 1000 + 12, findingEnd / 1000),
      reason: typeof localized.message === "string" ? localized.message : "Localized Mastering Inspector finding.",
    });
  }

  const before = record(result.before);
  const afterSignature = record(after.reference_signature);
  const beforeSignature = record(before.reference_signature);

  const beforeSections = Array.isArray(beforeSignature.section_signatures)
    ? beforeSignature.section_signatures.map(record)
    : [];
  const afterSections = Array.isArray(afterSignature.section_signatures)
    ? afterSignature.section_signatures.map(record)
    : [];
  const beforeById = new Map(beforeSections.flatMap((section) => {
    const id = typeof section.id === "string" ? section.id : null;
    return id ? [[id, section] as const] : [];
  }));
  const changedSection = afterSections
    .flatMap((section) => {
      const id = typeof section.id === "string" ? section.id : null;
      const source = id ? beforeById.get(id) : null;
      const startMs = number(section.start_ms);
      const endMs = number(section.end_ms);
      if (!source || startMs === null || endMs === null) return [];
      const sourceEnvelope = record(source.perceptual_envelope_db);
      const candidateEnvelope = record(section.perceptual_envelope_db);
      const shared = Object.keys(sourceEnvelope).filter((key) => (
        number(sourceEnvelope[key]) !== null && number(candidateEnvelope[key]) !== null
      ));
      if (shared.length < 3) return [];
      const distance = shared.reduce((sum, key) => (
        sum + Math.abs(Number(sourceEnvelope[key]) - Number(candidateEnvelope[key]))
      ), 0) / shared.length;
      return [{
        startMs,
        endMs,
        label: typeof section.label === "string" ? section.label : "section",
        distance,
      }];
    })
    .sort((left, right) => right.distance - left.distance)[0];
  if (changedSection && changedSection.distance >= 0.2) {
    loops.push({
      label: `Most changed section · ${changedSection.label}`,
      start: changedSection.startMs / 1000,
      end: Math.min(changedSection.startMs / 1000 + 12, changedSection.endMs / 1000),
      reason: `Largest measured section-level tonal-envelope movement (${changedSection.distance.toFixed(2)} dB mean absolute change).`,
    });
  }
  const rawSections = Array.isArray(afterSignature.section_signatures) && afterSignature.section_signatures.length
    ? afterSignature.section_signatures
    : beforeSignature.section_signatures;
  const sections = Array.isArray(rawSections)
    ? rawSections.map(record)
    : [];
  const bassSection = sections
    .map((section) => ({
      startMs: number(section.start_ms),
      endMs: number(section.end_ms),
      label: typeof section.label === "string" ? section.label : "section",
      bass: number(record(section.perceptual_envelope_db).sub_40_80),
    }))
    .filter((section) => section.startMs !== null && section.endMs !== null && section.bass !== null)
    .sort((a, b) => Number(b.bass) - Number(a.bass))[0];
  if (bassSection && bassSection.startMs !== null && bassSection.endMs !== null) {
    loops.push({
      label: `Bass-heavy · ${bassSection.label}`,
      start: bassSection.startMs / 1000,
      end: Math.min(bassSection.startMs / 1000 + 12, bassSection.endMs / 1000),
      reason: "This section has the strongest measured 40–80 Hz share and is useful for checking low-end translation.",
    });
  }

  const deduped: MasteringSuggestedLoop[] = [];
  for (const item of loops) {
    if (deduped.some((existing) => Math.abs(existing.start - item.start) < 2.5)) continue;
    deduped.push(item);
    if (deduped.length >= 4) break;
  }
  return deduped;
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

  async function keepOriginal(formData: FormData) {
    await keepOriginalMaster(formData);
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
            const optimizer = record(result.optimizer);
            const target = record(result.target);
            const artistDecision = record(result.artist_decision);
            const decision = typeof artistDecision.decision === "string" ? artistDecision.decision : null;
            const targetRange = record(target.loudness_range);
            const referenceIntelligence = record(target.reference_intelligence);
            const preferencePolicy = record(target.artist_preference_policy);
            const tightenedPreferenceBudget = record(preferencePolicy.tightened_budget);
            const suggestedLoops = masteringSuggestedLoops(job.result);
            const codecPreviews: MasteringCodecPreview[] = Array.isArray(result.codec_previews)
              ? result.codec_previews.flatMap((value) => {
                  const preview = record(value);
                  if (preview.status !== "ready" || typeof preview.public_url !== "string") return [];
                  return [{
                    profile: typeof preview.profile === "string" ? preview.profile : "codec",
                    url: preview.public_url,
                    mimeType: typeof preview.mime_type === "string" ? preview.mime_type : null,
                  }];
                })
              : [];
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

                {typeof optimizer.rationale === "string" || referenceIntelligence.automatic_influence === true ? (
                  <div className={styles.rationale}>
                    <strong>{typeof optimizer.rationale === "string" ? optimizer.rationale : "Source-first mastering with trusted-reference context."}</strong>
                    <span>
                      {number(targetRange.min_lufs) !== null && number(targetRange.max_lufs) !== null
                        ? `Clean target range ${number(targetRange.min_lufs)?.toFixed(1)} to ${number(targetRange.max_lufs)?.toFixed(1)} LUFS`
                        : "Target range follows the source and mastering intent."}
                      {referenceIntelligence.automatic_influence === true
                        ? ` · ${number(referenceIntelligence.selected_count) ?? 0} similar trusted references influenced the target`
                        : " · references stayed descriptive because influence confidence was not strong enough"}
                    </span>
                  </div>
                ) : null}

                {preferencePolicy.applied === true ? (
                  <details className="studio-advanced-details">
                    <summary>
                      <span>Artist Mastering DNA influenced this candidate</span>
                      <small>
                        {number(preferencePolicy.evidence_count) ?? 0} explicit mastering decision{number(preferencePolicy.evidence_count) === 1 ? "" : "s"} · confidence {metric(number(preferencePolicy.confidence), "", 2)}
                      </small>
                    </summary>
                    <p className="v2-muted-copy">
                      Ensemblis used your previous approved or kept-original mastering decisions only as a bounded creative prior.
                      It cannot loosen technical safety, change streaming-safe behavior or approve a master for you.
                    </p>
                    <div className={styles.metrics}>
                      <div>
                        <span>Loudness preference</span>
                        <strong>{metric(number(preferencePolicy.loudness_nudge_lu), " LU")}</strong>
                      </div>
                      <div>
                        <span>Limiter budget</span>
                        <strong>{metric(number(tightenedPreferenceBudget.max_limiter_gain_reduction_db), " dB")}</strong>
                      </div>
                      <div>
                        <span>EQ-change budget</span>
                        <strong>{metric(number(tightenedPreferenceBudget.max_total_eq_energy), " dB")}</strong>
                      </div>
                    </div>
                  </details>
                ) : null}

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
                    suggestedLoops={suggestedLoops}
                    codecPreviews={codecPreviews}
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
                    {decision === "approved" ? (
                      <span className={styles.decision}>Approved as canonical master</span>
                    ) : decision === "kept_original" ? (
                      <span className={styles.decision}>Original kept</span>
                    ) : (
                      <>
                        <form action={keepOriginal}>
                          <input type="hidden" name="job_id" value={job.id} />
                          <SubmitButton className="button" pendingLabel="Keeping original…">
                            Keep original
                          </SubmitButton>
                        </form>
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
                      </>
                    )}
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
