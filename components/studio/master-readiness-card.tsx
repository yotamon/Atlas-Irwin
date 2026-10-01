"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { MasterFinding, MasterReadiness } from "@/lib/mastering/readiness";
import styles from "./master-readiness-card.module.css";

function time(ms: number | null) {
  if (ms === null) return "";
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function categoryLabel(category: MasterFinding["category"]) {
  if (category === "streaming") return "Streaming";
  if (category === "render_stability") return "Render stability";
  if (category === "tempo") return "Timing";
  if (category === "technical") return "Technical";
  return "Listen";
}

function statusTone(status: MasterReadiness["status"]) {
  if (status === "ready") return "ready";
  if (status === "review") return "review";
  if (status === "fix_required") return "critical";
  return "neutral";
}

function actionCopy(readiness: MasterReadiness) {
  if (readiness.primaryAction === "mastering_fix") return "Make streaming-safe version";
  if (readiness.primaryAction === "replace_source") return "Replace source audio";
  if (readiness.primaryAction === "repair_source") return "Repair or replace source";
  if (readiness.primaryAction === "retry_analysis") return "Retry verification";
  if (readiness.primaryAction === "listen") return "Listen to findings";
  return "Continue with current master";
}

export function MasterReadinessCard({
  readiness,
  audioUrl,
  continueHref,
  replaceHref,
  retryHref = "#analysis-recovery",
  masteringHref = "#active-mastering",
}: {
  readiness: MasterReadiness;
  audioUrl: string | null;
  continueHref?: string | null;
  replaceHref?: string | null;
  retryHref?: string;
  masteringHref?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeFinding, setActiveFinding] = useState<MasterFinding | null>(null);
  const actionable = readiness.findings.filter((finding) => finding.severity !== "info");
  const hasMasteringFix = actionable.some((finding) => finding.masteringCanHelp);

  async function listen(finding: MasterFinding) {
    const audio = audioRef.current;
    if (!audio || finding.startMs === null) return;
    if (activeFinding?.code === finding.code) {
      audio.pause();
      setActiveFinding(null);
      return;
    }
    audio.currentTime = Math.max(0, finding.startMs / 1000 - 1.5);
    setActiveFinding(finding);
    await audio.play().catch(() => setActiveFinding(null));
  }

  const primaryHref =
    readiness.primaryAction === "mastering_fix"
      ? masteringHref
      : readiness.primaryAction === "replace_source" || readiness.primaryAction === "repair_source"
        ? replaceHref ?? retryHref
        : readiness.primaryAction === "retry_analysis"
          ? retryHref
          : continueHref ?? null;

  return (
    <section className={styles.root} data-tone={statusTone(readiness.status)} aria-labelledby="master-readiness-title">
      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        preload="metadata"
        onTimeUpdate={(event) => {
          if (!activeFinding?.endMs || activeFinding.startMs === null) return;
          const end = activeFinding.endMs / 1000 + 1;
          if (event.currentTarget.currentTime >= end) {
            event.currentTarget.currentTime = Math.max(0, activeFinding.startMs / 1000 - 1.5);
            void event.currentTarget.play().catch(() => setActiveFinding(null));
          }
        }}
        onEnded={() => setActiveFinding(null)}
      />
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className="section-label">Master Readiness</span>
          <div className={styles.statusLine}>
            <span className={styles.statusIcon} aria-hidden>{readiness.status === "ready" ? "✓" : readiness.status === "fix_required" ? "!" : "●"}</span>
            <h3 id="master-readiness-title">{readiness.headline}</h3>
          </div>
          <p>{readiness.summary}</p>
        </div>
        <div className={styles.heroAction}>
          {primaryHref ? <Link className="button primary" href={primaryHref}>{actionCopy(readiness)}</Link> : null}
          {readiness.status === "ready" && !primaryHref ? <strong className={styles.noAction}>No change needed</strong> : null}
          <small>{readiness.status === "ready" ? "The current master remains untouched." : readiness.blockerCount ? `${readiness.blockerCount} release blocker${readiness.blockerCount === 1 ? "" : "s"}` : `${readiness.reviewCount} item${readiness.reviewCount === 1 ? "" : "s"} worth hearing`}</small>
        </div>
      </header>

      <div className={styles.signals} aria-label="Master readiness summary">
        <div><span>Technical integrity</span><strong>{readiness.technicalReady === true ? "Verified" : readiness.technicalReady === false ? "Needs a fix" : "Checking"}</strong></div>
        <div><span>Distribution</span><strong>{readiness.distributionGate === "pass" ? "Audio verified" : readiness.distributionGate === "review" ? "Review suggested" : readiness.distributionGate === "block" ? "Blocked" : readiness.distributionGate === "waiting" ? "Checking" : "Unverified"}</strong></div>
        <div><span>Source identity</span><strong>{readiness.sourceMatchesCurrent === false ? "Fresh check needed" : readiness.sourceMatchesCurrent === true ? "Current waveform" : "Legacy identity"}</strong></div>
      </div>

      {actionable.length ? (
        <div className={styles.findings}>
          <div className={styles.sectionHead}>
            <div><span className="section-label">Listen before deciding</span><h4>{readiness.status === "fix_required" ? "What must change" : "What is worth checking"}</h4></div>
            <span>{actionable.length}</span>
          </div>
          {actionable.map((finding) => (
            <article className={styles.finding} data-severity={finding.severity} key={finding.code}>
              <div className={styles.findingCopy}>
                <small>{categoryLabel(finding.category)}{finding.startMs !== null ? ` · ${time(finding.startMs)}` : ""}</small>
                <strong>{finding.title}</strong>
                <p>{finding.detail}</p>
              </div>
              {finding.startMs !== null && audioUrl ? (
                <button type="button" className="button" aria-pressed={activeFinding?.code === finding.code} onClick={() => void listen(finding)}>
                  {activeFinding?.code === finding.code ? "Stop loop" : `▶ Loop ${time(finding.startMs)}`}
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : readiness.status === "ready" ? (
        <div className={styles.calm}>
          <strong>No corrective mastering is recommended.</strong>
          <span>Open technical details only if you want to inspect the measurements.</span>
        </div>
      ) : null}

      {readiness.status === "review" && hasMasteringFix && readiness.primaryAction !== "mastering_fix" ? (
        <div className={styles.secondaryAction}>
          <div><strong>Want extra streaming headroom?</strong><span>Ensemblis can create a source-preserving candidate and verify it before you choose.</span></div>
          <Link className="button" href={masteringHref}>Make streaming-safe version</Link>
        </div>
      ) : null}
    </section>
  );
}

