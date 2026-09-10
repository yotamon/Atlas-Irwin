import Link from "next/link";
import styles from "./track-analysis-progress.module.css";

type TrackAnalysisProgressProps = {
  status: string;
  isActive: boolean;
  isRefreshing: boolean;
  isPartial: boolean;
  needsRecovery: boolean;
  failureCopy: string;
};

type AnalysisStep = {
  label: string;
  description: string;
};

const STEPS: AnalysisStep[] = [
  { label: "Master ready", description: "Source audio is safely attached" },
  { label: "Queued", description: "Waiting for the analysis worker" },
  { label: "Listening", description: "Reading structure, tempo and strong Moments" },
  { label: "Ready", description: "Music intelligence is available" },
];

function activeStepFor(status: string) {
  if (status === "dispatched" || status === "running") return 2;
  return 1;
}

function activeCopy(status: string, isRefreshing: boolean) {
  if (status === "pending") {
    return {
      eyebrow: "Preparing analysis",
      headline: isRefreshing ? "Preparing a fresh intelligence pass" : "Preparing to understand this track",
      detail: isRefreshing
        ? "Your current verified intelligence stays available while Ensemblis prepares the new pass."
        : "The master is ready. Ensemblis is preparing the analysis job automatically.",
    };
  }

  if (status === "queued") {
    return {
      eyebrow: "Analysis queued",
      headline: isRefreshing ? "Your refresh is in the queue" : "Your track is ready to be heard",
      detail: isRefreshing
        ? "Nothing is being replaced yet. Current verified intelligence remains live until the fresh pass completes."
        : "The source is safe and the free Media Worker will start listening as soon as it is available.",
    };
  }

  if (status === "dispatched") {
    return {
      eyebrow: "Worker starting",
      headline: isRefreshing ? "A fresh listen is starting" : "Ensemblis is starting the deep listen",
      detail: isRefreshing
        ? "The worker has the job. Existing intelligence remains usable while the new pass starts."
        : "The worker has the job and is opening the source audio for the full intelligence pass.",
    };
  }

  return {
    eyebrow: "Listening now",
    headline: isRefreshing ? "Ensemblis is refreshing what it hears" : "Ensemblis is understanding your track",
    detail: isRefreshing
      ? "Current verified results stay visible while Ensemblis listens again for structure, tempo, strong Moments and mastering signals."
      : "Ensemblis is listening for structure, tempo, strong Moments and mastering signals. Deep audio passes can take several minutes.",
  };
}

export function TrackAnalysisProgress({
  status,
  isActive,
  isRefreshing,
  isPartial,
  needsRecovery,
  failureCopy,
}: TrackAnalysisProgressProps) {
  if (needsRecovery) {
    return (
      <section className={`${styles.surface} ${styles.recovery}`} aria-live="polite" aria-label="Track Intelligence needs attention">
        <div className={styles.recoveryMarker} aria-hidden>!</div>
        <div className={styles.copy}>
          <span className={styles.eyebrow}>{isPartial ? "Intelligence partially available" : "Analysis paused"}</span>
          <h2>{isPartial ? "Your verified results are still here" : "The master is safe. Only analysis needs another try."}</h2>
          <p>{failureCopy}</p>
        </div>
        <Link className={styles.action} href="#analysis-recovery">Retry intelligence →</Link>
      </section>
    );
  }

  if (!isActive) return null;

  const currentStep = activeStepFor(status);
  const copy = activeCopy(status, isRefreshing);
  const stageProgress = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <section className={styles.surface} aria-live="polite" aria-label="Track Intelligence progress">
      <div className={styles.progressHeader}>
        <div className={styles.copy}>
          <span className={styles.eyebrow}>{copy.eyebrow}</span>
          <h2>{copy.headline}</h2>
          <p>{copy.detail}</p>
        </div>
        <div className={styles.activity} aria-hidden>
          <span />
          <span />
          <span />
        </div>
      </div>

      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-label="Analysis stages"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={currentStep + 1}
        aria-valuetext={`Stage ${currentStep + 1} of ${STEPS.length}: ${STEPS[currentStep].label}`}
      >
        <span className={styles.progressFill} style={{ width: `${stageProgress}%` }} />
      </div>

      <ol className={styles.steps}>
        {STEPS.map((step, index) => {
          const state = index < currentStep ? "complete" : index === currentStep ? "current" : "upcoming";
          return (
            <li className={styles[state]} key={step.label} aria-current={state === "current" ? "step" : undefined}>
              <span className={styles.stepMarker} aria-hidden>{state === "complete" ? "✓" : index + 1}</span>
              <span className={styles.stepCopy}>
                <strong>{step.label}</strong>
                <span>{step.description}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
