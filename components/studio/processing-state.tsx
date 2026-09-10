import type { CSSProperties } from "react";

type ProcessingStep = {
  label: string;
  state?: "waiting" | "active" | "complete";
};

type ProcessingStateProps = {
  eyebrow?: string;
  title: string;
  detail?: string;
  progress?: number;
  steps?: ProcessingStep[];
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
  announce?: boolean;
};

function stateLabel(state: ProcessingStep["state"]) {
  if (state === "complete") return "complete";
  if (state === "active") return "in progress";
  return "waiting";
}

export function ProcessingState({
  eyebrow = "Ensemblis",
  title,
  detail,
  progress,
  steps,
  compact = false,
  className,
  ariaLabel,
  announce = true,
}: ProcessingStateProps) {
  const normalizedProgress =
    typeof progress === "number" ? Math.min(100, Math.max(0, progress)) : null;
  const classes = ["ensemblis-processing", compact ? "is-compact" : null, className]
    .filter(Boolean)
    .join(" ");
  const activeStep = steps?.find((step) => step.state === "active");
  const announcement = [
    ariaLabel || title,
    normalizedProgress !== null ? `${Math.round(normalizedProgress)} percent` : null,
    activeStep ? `${activeStep.label} in progress` : null,
  ].filter(Boolean).join(". ");

  return (
    <section className={classes} aria-busy={announce ? true : undefined} aria-label={ariaLabel}>
      {announce ? <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span> : null}
      <div className="ensemblis-processing-visual" aria-hidden="true">
        <span className="ensemblis-processing-scan" />
        <div className="ensemblis-processing-wave">
          {Array.from({ length: 13 }, (_, index) => (
            <i key={index} style={{ "--wave-index": index } as CSSProperties} />
          ))}
        </div>
      </div>

      <div className="ensemblis-processing-copy">
        <span className="ensemblis-processing-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {detail ? <p>{detail}</p> : null}

        {normalizedProgress !== null ? (
          <div
            className="ensemblis-processing-progress"
            role="progressbar"
            aria-label={ariaLabel || title}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(normalizedProgress)}
            aria-valuetext={`${Math.round(normalizedProgress)} percent complete`}
          >
            <span style={{ width: `${normalizedProgress}%` }} />
          </div>
        ) : null}

        {steps?.length ? (
          <ol className="ensemblis-processing-steps">
            {steps.map((step) => {
              const status = stateLabel(step.state);
              return (
                <li key={step.label} data-state={step.state ?? "waiting"}>
                  <span aria-hidden="true" />
                  <span>{step.label}</span>
                  <small className="ensemblis-processing-step-state">{status}</small>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </section>
  );
}
