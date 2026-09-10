/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { ReactNode } from "react";

type ObjectHeaderTab = {
  label: string;
  href: string;
  active?: boolean;
};

type ObjectHeaderFact = {
  label: string;
  value: ReactNode;
};

export function ObjectHeader({
  backHref,
  backLabel,
  eyebrow,
  title,
  subtitle,
  imageUrl,
  imageAlt = "",
  facts = [],
  actions,
  tabs = [],
}: {
  backHref: string;
  backLabel: string;
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  imageUrl?: string | null;
  imageAlt?: string;
  facts?: ObjectHeaderFact[];
  actions?: ReactNode;
  tabs?: ObjectHeaderTab[];
}) {
  return (
    <header className="ensemblis-object-header">
      <div className="ensemblis-object-topline">
        <Link className="ensemblis-object-back" href={backHref}>← {backLabel}</Link>
        {actions ? <div className="ensemblis-object-actions">{actions}</div> : null}
      </div>
      <div className="ensemblis-object-identity">
        {imageUrl ? <img className="ensemblis-object-artwork" src={imageUrl} alt={imageAlt} /> : <div className="ensemblis-object-artwork is-empty" aria-hidden>{title.slice(0, 1).toUpperCase()}</div>}
        <div className="ensemblis-object-copy">
          {eyebrow ? <span className="section-label">{eyebrow}</span> : null}
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
          {facts.length ? (
            <dl className="ensemblis-object-facts">
              {facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
            </dl>
          ) : null}
        </div>
      </div>
      {tabs.length ? (
        <nav className="ensemblis-object-tabs" aria-label={`${title} workspace`}>
          {tabs.map((tab) => <Link className={tab.active ? "active" : ""} aria-current={tab.active ? "page" : undefined} href={tab.href} key={tab.label}>{tab.label}</Link>)}
        </nav>
      ) : null}
    </header>
  );
}
