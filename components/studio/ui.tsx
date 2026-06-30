import type { ReactNode } from "react";
import Link from "next/link";
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
      {action}
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
    <section className={`studio-panel ${className}`}>
      {(title || action) && (
        <div className="panel-head">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
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
    <div className="empty-state">
      <div className="empty-orbit" />
      <h3>{title}</h3>
      <p>{body}</p>
      {href && (
        <Link className="button" href={href}>
          {label}
        </Link>
      )}
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
export function Submit({
  children = "Save changes",
}: {
  children?: ReactNode;
}) {
  return (
    <button className="button primary" type="submit">
      {children}
    </button>
  );
}
export function FormatTime({ seconds }: { seconds: number | null }) {
  if (seconds === null) return <>—</>;
  return (
    <>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </>
  );
}
