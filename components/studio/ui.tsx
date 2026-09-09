import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import Link from "next/link";
import { SubmitButton } from "./submit-button";
import { EnsemblisTooltip } from "./tooltip";

type ButtonVariant = "default" | "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";
export type StatusTone = "neutral" | "accent" | "success" | "attention" | "danger";
type PageWidth = "narrow" | "default" | "wide" | "full";
type GridColumns = 2 | 3 | 4;

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function buttonClassName(variant: ButtonVariant, size: ButtonSize, className = "") {
  return classes(
    "button",
    variant !== "default" && variant,
    size !== "md" && `button-${size}`,
    className,
  );
}

export function Button({
  variant = "default",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button {...props} type={type} className={buttonClassName(variant, size, className)} />;
}

export function ButtonLink({
  href,
  children,
  variant = "default",
  size = "md",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return <Link href={href} className={buttonClassName(variant, size, className)}>{children}</Link>;
}

export function IconButton({
  label,
  children,
  className = "",
  variant = "ghost",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & {
  label: string;
  children: ReactNode;
  variant?: ButtonVariant;
}) {
  return (
    <EnsemblisTooltip label={label}>
      <Button
        {...props}
        variant={variant}
        aria-label={label}
        data-icon-button
        className={className}
      >
        {children}
      </Button>
    </EnsemblisTooltip>
  );
}

export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  return <EnsemblisTooltip label={label}>{children}</EnsemblisTooltip>;
}

export function Page({
  children,
  width = "default",
  className = "",
}: {
  children: ReactNode;
  width?: PageWidth;
  className?: string;
}) {
  return (
    <div
      className={classes("studio-page", className)}
      data-width={width === "default" ? undefined : width}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  action,
  actions,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  actions?: ReactNode;
}) {
  const resolvedActions = actions ?? action;
  return (
    <header className="studio-page-header">
      <div className="studio-page-header-copy">
        {eyebrow ? <span className="en-eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {resolvedActions ? <div className="actions">{resolvedActions}</div> : null}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  eyebrow,
  action,
}: {
  title?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="studio-section-header">
      <div className="studio-section-header-copy">
        {eyebrow ? <span className="en-eyebrow">{eyebrow}</span> : null}
        {title ? <h2>{title}</h2> : null}
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="studio-actions">{action}</div> : null}
    </div>
  );
}

export function Section({
  title,
  description,
  eyebrow,
  action,
  children,
  feature = false,
  className = "",
}: {
  title?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  feature?: boolean;
  className?: string;
}) {
  return (
    <section
      className={classes("studio-section", className)}
      data-surface={feature ? "feature" : undefined}
    >
      {(title || description || eyebrow || action) ? (
        <SectionHeader
          title={title}
          description={description}
          eyebrow={eyebrow}
          action={action}
        />
      ) : null}
      {children ?? null}
    </section>
  );
}

export function Stack({
  children,
  gap = "default",
  className = "",
}: {
  children: ReactNode;
  gap?: "compact" | "default" | "roomy";
  className?: string;
}) {
  return (
    <div className={classes("studio-stack", className)} data-gap={gap === "default" ? undefined : gap}>
      {children}
    </div>
  );
}

export function Grid({
  children,
  columns,
  className = "",
}: {
  children: ReactNode;
  columns?: GridColumns;
  className?: string;
}) {
  return <div className={classes("studio-grid", className)} data-columns={columns}>{children}</div>;
}

export function Split({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={classes("studio-split", className)}>{children}</div>;
}

export function Actions({
  children,
  align = "start",
  className = "",
}: {
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  return <div className={classes("studio-actions", className)} data-align={align}>{children}</div>;
}

export function ActionBar({
  children,
  message,
  className = "",
}: {
  children: ReactNode;
  message?: ReactNode;
  className?: string;
}) {
  return (
    <div className={classes("studio-action-bar", className)}>
      {message ? <div className="studio-action-bar-copy">{message}</div> : null}
      <Actions align="end" className="studio-action-bar-actions">{children}</Actions>
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={classes("studio-panel", className)}>
      {(title || action) && (
        <div className="panel-head">
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Surface({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={classes("studio-panel", "feature", className)}>{children}</section>;
}

export function StatePanel({
  title,
  body,
  children,
  icon,
  tone = "neutral",
  role,
  className = "",
}: {
  title: string;
  body?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  tone?: StatusTone;
  role?: "status" | "alert";
  className?: string;
}) {
  return (
    <div className={classes("studio-state", className)} data-tone={tone} role={role}>
      {icon ? <div className="studio-state-icon" aria-hidden>{icon}</div> : null}
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {children ? <Actions>{children}</Actions> : null}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  href,
  label,
}: {
  title: string;
  body: string;
  href?: string;
  label?: string;
}) {
  return (
    <StatePanel title={title} body={body}>
      {href && label ? <ButtonLink href={href}>{label}</ButtonLink> : null}
    </StatePanel>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="studio-state studio-state-loading" role="status" aria-live="polite">
      <div className="studio-loading" aria-hidden><span /><span /><span /></div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Status({ children, tone = "accent" }: { children: ReactNode; tone?: StatusTone }) {
  return <span className="status-chip" data-tone={tone}>{children}</span>;
}

export function Notice({
  children,
  tone = "neutral",
  role,
}: {
  children: ReactNode;
  tone?: StatusTone;
  role?: "status" | "alert";
}) {
  return <div className="ensemblis-notice" data-tone={tone} role={role}>{children}</div>;
}

export function Field({
  label,
  children,
  wide = false,
  hint,
  error,
  required = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
}) {
  return (
    <label className={classes("field", wide && "wide")} data-invalid={Boolean(error) || undefined}>
      <span>{label}{required ? <small aria-hidden> · required</small> : null}</span>
      {children}
      {hint ? <small className="field-hint">{hint}</small> : null}
      {error ? <small className="field-error" role="alert">{error}</small> : null}
    </label>
  );
}

export function FormSection({
  title,
  description,
  children,
  className = "",
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={classes("ensemblis-form-section", className)}>
      {(title || description) ? <SectionHeader title={title} description={description} /> : null}
      {children}
    </section>
  );
}

export function FormGrid({
  children,
  columns = 2,
  className = "",
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  return <div className={classes("studio-form-grid", className)} data-columns={columns}>{children}</div>;
}

export function FormActions({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={classes("form-actions", className)}>{children}</div>;
}

export function Progress({ value, label }: { value: number; label: string }) {
  const normalized = Math.min(100, Math.max(0, value));
  return (
    <div
      className="ensemblis-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(normalized)}
    >
      <span style={{ width: `${normalized}%` }} />
    </div>
  );
}

export function Skeleton({ className = "", label = "Loading" }: { className?: string; label?: string }) {
  return <span className={classes("ensemblis-skeleton", className)} role="status" aria-label={label} />;
}

export function Tabs({
  label,
  items,
}: {
  label: string;
  items: Array<{ label: string; href: string; active?: boolean }>;
}) {
  return (
    <nav className="studio-tabs" aria-label={label}>
      {items.map((item) => (
        <Link key={item.href} href={item.href} className={item.active ? "active" : undefined} aria-current={item.active ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function Disclosure({
  label,
  children,
  className = "studio-advanced-details",
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <details className={className}><summary>{label}</summary>{children}</details>;
}

export function Submit({ children = "Save changes", disabled = false }: { children?: ReactNode; disabled?: boolean }) {
  return <SubmitButton disabled={disabled}>{children}</SubmitButton>;
}

export function FormatTime({ seconds }: { seconds: number | null }) {
  if (seconds === null) return <>—</>;
  return <>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</>;
}
