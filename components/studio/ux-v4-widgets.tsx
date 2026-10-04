import Link from "next/link";
import type { ReactNode } from "react";
import { Status, type StatusTone } from "@/components/studio/ui";

export type ObjectAction = {
  label: string;
  href: string;
  primary?: boolean;
};

export const MAX_VISIBLE_SECONDARY_ACTIONS = 2;

export function ObjectActionBar({
  actions,
  more,
}: {
  actions: ObjectAction[];
  more?: ReactNode;
}) {
  if (!actions.length && !more) return null;

  const primaryActions = actions.filter((action) => action.primary);
  if (primaryActions.length > 1) {
    throw new Error("ObjectActionBar supports only one primary action.");
  }

  const primaryAction = primaryActions[0] ?? null;
  const secondaryActions = actions.filter((action) => action !== primaryAction);
  const visibleActions = [
    ...(primaryAction ? [primaryAction] : []),
    ...secondaryActions.slice(0, MAX_VISIBLE_SECONDARY_ACTIONS),
  ];
  const overflowActions = secondaryActions.slice(MAX_VISIBLE_SECONDARY_ACTIONS);

  return (
    <div className="en-object-action-bar" aria-label="Available actions">
      <div className="en-object-action-primary">
        {visibleActions.map((action) => (
          <Link
            className={action.primary ? "button primary" : "button"}
            data-action-role={action.primary ? "primary" : "secondary"}
            href={action.href}
            key={`${action.label}:${action.href}`}
          >
            {action.label}
          </Link>
        ))}
      </div>
      {overflowActions.length || more ? (
        <div className="en-object-action-more">
          {overflowActions.length ? (
            <details className="en-object-action-overflow">
              <summary>More actions</summary>
              <div>
                {overflowActions.map((action) => (
                  <Link data-action-role="secondary" href={action.href} key={`${action.label}:${action.href}`}>{action.label}</Link>
                ))}
              </div>
            </details>
          ) : null}
          {more}
        </div>
      ) : null}
    </div>
  );
}

export function ContinueWidget({
  eyebrow,
  title,
  detail,
  status,
  tone = "neutral",
  href,
  actionLabel = "Continue",
}: {
  eyebrow: string;
  title: string;
  detail: string;
  status?: string;
  tone?: StatusTone;
  href: string;
  actionLabel?: string;
}) {
  return (
    <Link className="en-continue-widget" href={href}>
      <span className="en-continue-widget-copy">
        <small>{eyebrow}</small>
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <span className="en-continue-widget-side">
        {status ? <Status tone={tone}>{status}</Status> : null}
        <b>{actionLabel} →</b>
      </span>
    </Link>
  );
}
export function InsightWidget({
  label,
  value,
  detail,
  action,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="en-insight-widget">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
      {action ? <div className="en-insight-widget-action">{action}</div> : null}
    </section>
  );
}

export function ConnectionWidget({
  name,
  detail,
  connected,
  action,
}: {
  name: string;
  detail: string;
  connected: boolean;
  action?: ReactNode;
}) {  return (
    <section className="en-connection-widget">
      <span className={connected ? "is-connected" : "is-offline"} aria-hidden />
      <div>
        <small>{connected ? "Connected" : "Connection needed"}</small>
        <strong>{name}</strong>
        <span>{detail}</span>
      </div>
      {action ? <div className="en-connection-widget-action">{action}</div> : null}
    </section>
  );
}

export function ObjectStateSummary({
  label,
  title,
  detail,
  tone = "neutral",
  action,
}: {
  label: string;
  title: ReactNode;
  detail?: ReactNode;
  tone?: StatusTone;
  action?: ReactNode;
}) {
  return (
    <section className="en-object-state-summary" data-tone={tone}>
      <div>
        <Status tone={tone}>{label}</Status>
        <strong>{title}</strong>
        {detail ? <p>{detail}</p> : null}
      </div>
      {action ? <div className="en-object-state-action">{action}</div> : null}
    </section>
  );
}

export function NextActionWidget({
  eyebrow = "Next",
  title,
  detail,
  action,
  secondary,
}: {
  eyebrow?: string;
  title: ReactNode;
  detail: ReactNode;
  action: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <section className="en-next-action-widget">
      <span className="section-label">{eyebrow}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
      <div className="actions">{action}{secondary}</div>
    </section>
  );
}

export function CompactEvidence({
  label = "Why this?",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <details className="en-compact-evidence">
      <summary>{label}</summary>
      <div>{children}</div>
    </details>
  );
}

export type WorkflowStep<T extends string> = {
  id: T;
  label: string;
  complete?: boolean;
  disabled?: boolean;
};

export function WorkflowStepper<T extends string>({
  steps,
  current,
  onSelect,
}: {
  steps: WorkflowStep<T>[];
  current: T;
  onSelect?: (step: T) => void;
}) {
  const currentIndex = steps.findIndex((step) => step.id === current);
  return (
    <nav className="en-workflow-stepper" aria-label="Workflow progress">
      {steps.map((step, index) => {
        const active = step.id === current;
        const complete = step.complete ?? index < currentIndex;
        return (
          <button
            key={step.id}
            type="button"
            className={active ? "is-active" : complete ? "is-complete" : undefined}
            aria-current={active ? "step" : undefined}
            data-workflow-stage={step.id}
            disabled={step.disabled}
            onClick={() => onSelect?.(step.id)}
          >
            <span>{complete ? "✓" : index + 1}</span>
            <strong>{step.label}</strong>
          </button>
        );
      })}
    </nav>
  );
}
