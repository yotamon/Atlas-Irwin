import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { SubmitButton } from "./submit-button";

type ButtonVariant = "default" | "primary" | "danger";

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
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { label: string; children: ReactNode }) {
  return <Button {...props} aria-label={label} title={props.title ?? label} className={className}>{children}</Button>;
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

export function Status({ children }: { children: ReactNode }) {
  return <span className="status-chip">{children}</span>;
}

export function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "field wide" : "field"}>
      <span>{label}</span>
      {children}
    </label>
  );
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

export function Submit({ children = "Save changes" }: { children?: ReactNode }) {
  return <SubmitButton>{children}</SubmitButton>;
}

export function FormatTime({ seconds }: { seconds: number | null }) {
  if (seconds === null) return <>—</>;
  return <>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</>;
}
