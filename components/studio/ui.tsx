import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import Link from "next/link";
import { SubmitButton } from "./submit-button";
import { EnsemblisTooltip } from "./tooltip";

type ButtonVariant = "default" | "primary" | "danger";
export type StatusTone = "neutral" | "accent" | "success" | "attention" | "danger";

function buttonClassName(variant: ButtonVariant, className = "") {
  const variantClass = variant === "primary" ? " primary" : variant === "danger" ? " danger-text" : "";
  return `button${variantClass}${className ? ` ${className}` : ""}`;
}

export function Button({ variant = "default", className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button {...props} type={type} className={buttonClassName(variant, className)} />;
}

export function ButtonLink({
  href,
  children,
  variant = "default",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: Exclude<ButtonVariant, "danger">;
  className?: string;
}) {
  return <Link href={href} className={buttonClassName(variant, className)}>{children}</Link>;
}

export function IconButton({
  label,
  children,
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & { label: string; children: ReactNode }) {
  return (
    <EnsemblisTooltip label={label}>
      <Button
        {...props}
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

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="studio-page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action ? <div className="actions">{action}</div> : null}
    </header>
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
    <section className={`studio-panel${className ? ` ${className}` : ""}`}>
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
  return <section className={`studio-panel feature${className ? ` ${className}` : ""}`}>{children}</section>;
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
    <div className="empty-state">
      <div className="empty-orbit" aria-hidden />
      <h3>{title}</h3>
      <p>{body}</p>
      {href && label ? <ButtonLink href={href}>{label}</ButtonLink> : null}
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
    <label className={wide ? "field wide" : "field"} data-invalid={Boolean(error) || undefined}>
      <span>{label}{required ? <small aria-hidden> · required</small> : null}</span>
      {children}
      {hint ? <small className="field-hint">{hint}</small> : null}
      {error ? <small className="field-error" role="alert">{error}</small> : null}
    </label>
  );
}

export function FormSection({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`ensemblis-form-section${className ? ` ${className}` : ""}`}>{children}</section>;
}

export function FormActions({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`form-actions${className ? ` ${className}` : ""}`}>{children}</div>;
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
  return <span className={`ensemblis-skeleton${className ? ` ${className}` : ""}`} role="status" aria-label={label} />;
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
