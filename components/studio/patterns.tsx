import Link from "next/link";
import type { ReactNode } from "react";
import { Status } from "./ui";

export type SemanticTone = "neutral" | "accent" | "attention" | "danger" | "success";

function classes(base: string, extra?: string) {
  return `${base}${extra ? ` ${extra}` : ""}`;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={classes(`en-section-heading${compact ? " is-compact" : ""}`, className)}>
      <div className="en-section-heading-copy">
        {eyebrow ? <span className="en-eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="en-section-heading-action">{action}</div> : null}
    </div>
  );
}

export function PriorityHero({
  eyebrow,
  title,
  description,
  status,
  actions,
  tone = "accent",
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  tone?: SemanticTone;
  className?: string;
}) {
  return (
    <section className={classes("en-priority-hero", className)} data-tone={tone}>
      <div className="en-priority-hero-heading">
        <div className="en-priority-hero-copy">
          {eyebrow ? <span className="en-eyebrow">{eyebrow}</span> : null}
          <h2>{title}</h2>
        </div>
        {status ? <Status>{status}</Status> : null}
      </div>
      <p className="en-priority-hero-description">{description}</p>
      {actions ? <div className="en-priority-hero-actions">{actions}</div> : null}
    </section>
  );
}

export function DecisionQueue({
  eyebrow,
  title,
  count,
  action,
  children,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingAction = (
    <div className="actions">
      {typeof count === "number" ? <span className={`today-v3-count${count ? " has-items" : ""}`}>{count}</span> : null}
      {action}
    </div>
  );
  return (
    <section className={classes("en-decision-queue", className)}>
      <SectionHeading eyebrow={eyebrow} title={title} action={headingAction} compact />
      <div className="en-decision-list">{children}</div>
    </section>
  );
}

export function DecisionRow({
  href,
  meta,
  title,
  description,
  tone = "neutral",
  trailing,
}: {
  href: string;
  meta?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  tone?: SemanticTone;
  trailing?: ReactNode;
}) {
  return (
    <Link className="en-decision-row" href={href} data-tone={tone}>
      <span className="en-decision-copy">
        {meta ? <small className="en-decision-meta">{meta}</small> : null}
        <strong>{title}</strong>
        {description ? <span className="en-decision-description">{description}</span> : null}
      </span>
      <span className="en-decision-trailing" aria-hidden>{trailing ?? "→"}</span>
    </Link>
  );
}

export function MetricStrip({
  items,
  note,
  ariaLabel,
  className,
}: {
  items: Array<{ value: ReactNode; label: ReactNode }>;
  note?: ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <section className={classes("en-metric-strip", className)} aria-label={ariaLabel}>
      {items.map((item, index) => <div key={index}><strong>{item.value}</strong><span>{item.label}</span></div>)}
      {note ? <p className="en-metric-note">{note}</p> : null}
    </section>
  );
}

export function CalmState({
  title,
  body,
  children,
  inline = false,
  className,
}: {
  title: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
  inline?: boolean;
  className?: string;
}) {
  return (
    <div className={classes(`en-calm-state${inline ? " is-inline" : ""}`, className)}>
      <strong>{title}</strong>
      {body ? <p>{body}</p> : null}
      {children}
    </div>
  );
}
