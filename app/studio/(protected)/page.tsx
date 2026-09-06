import Link from "next/link";
import { PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { loadArtistOperatingSnapshot } from "@/lib/studio/artist-operating-snapshot";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { needsYouTone } from "@/lib/studio/needs-you";
import { formatOperatingDateTime } from "@/lib/studio/operating-preferences";

export default async function TodayPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const snapshot = await loadArtistOperatingSnapshot({
    db: supabase,
    userId: user.id,
    artist,
  });
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);
  const { activeRelease, activeMission, needsYou, topDecision, nextAction, nextActionHref, working, comingUp, preferences } = snapshot;

  const missionAction = activeMission?.nextAction ?? null;
  const heroTitle = topDecision?.title || missionAction?.title || nextAction?.title || "Ensemblis can keep moving without interrupting you";
  const heroDetail = topDecision?.detail || (missionAction ? activeMission?.summary : null) || nextAction?.rationale || "Safe internal work can continue. Ensemblis will surface the next decision when your judgment is actually useful.";
  const heroStatus = topDecision ? (topDecision.severity === "required" ? "Required" : "Needs attention") : missionAction ? activeMission?.label || "Recommended" : nextAction ? "Recommended" : "Clear";
  const heroPrimary = topDecision
    ? { href: href(topDecision.href), label: "Resolve this" }
    : missionAction
      ? { href: href(missionAction.href), label: missionAction.title }
      : nextAction && nextActionHref
        ? { href: nextActionHref, label: "Act on this" }
        : null;

  return <div className="studio-v2-page ensemblis-today-v3">
    <PageHeader
      title="Today"
      description={`What matters now for ${artist.artistName}.`}
      action={needsYou.length ? <Link className="button" aria-label="Needs you decision queue" href={href("/studio/needs-you")}>Needs You ({needsYou.length})</Link> : undefined}
    />

    <section className="today-v3-next" aria-labelledby="today-next-heading" aria-label="Active release Mission">
      <div className="today-v3-section-heading">
        <div>
          <span className="section-label">{activeRelease && activeMission ? `${activeRelease.title} · ${activeMission.label}` : "Recommended next move"}</span>
          <h2 id="today-next-heading">{heroTitle}</h2>
        </div>
        <Status>{heroStatus}</Status>
      </div>
      <p>{heroDetail}</p>
      <div className="actions">
        {heroPrimary ? <Link className="button primary" href={heroPrimary.href}>{heroPrimary.label}</Link> : null}
        {activeRelease
          ? <Link className="today-v3-secondary-link" href={href(`/studio/releases/${activeRelease.id}`)}>View release Mission</Link>
          : topDecision
            ? <Link className="today-v3-secondary-link" href={href("/studio/needs-you")}>Open decision queue</Link>
            : nextAction
              ? <Link className="today-v3-secondary-link" href={href("/studio/growth")}>Inspect evidence</Link>
              : null}
      </div>
    </section>

    <div className="today-v3-two-column">
      <section className="today-v3-section" aria-labelledby="today-needs-you-heading">
        <div className="today-v3-section-heading compact">
          <div><span className="section-label">Decision queue</span><h2 id="today-needs-you-heading">Needs You</h2></div>
          <div className="actions">
            <span className={`today-v3-count${needsYou.length ? " has-items" : ""}`}>{needsYou.length}</span>
            <Link className="today-v3-secondary-link" href={href("/studio/needs-you")}>Open queue</Link>
          </div>
        </div>
        {needsYou.length ? <div className="today-v3-list">{needsYou.map((item) =>
          <Link className={`today-v3-row ${needsYouTone(item)}`} href={href(item.href)} key={item.id}>
            <span className="today-v3-row-copy"><small>{item.category} · {item.severity}</small><strong>{item.title}</strong><span>{item.detail}</span></span>
            <span className="today-v3-arrow" aria-hidden>→</span>
          </Link>)}</div> : <div className="today-v3-calm-state compact"><strong>Nothing needs your judgment right now.</strong><p>Approvals, ambiguity and important decisions appear here only when needed.</p></div>}
      </section>

      <section className="today-v3-section" aria-labelledby="today-working-heading">
        <div className="today-v3-section-heading compact">
          <div><span className="section-label">Autonomous work</span><h2 id="today-working-heading">Working</h2></div>
          <span className={`today-v3-count${working.length ? " is-working" : ""}`}>{working.length}</span>
        </div>
        {working.length ? <div className="today-v3-list">{working.map((item) =>
          <Link className="today-v3-work-row" href={item.href} key={item.id}>
            <span className="today-v3-working-dot" aria-hidden />
            <span className="today-v3-row-copy"><strong>{item.title}</strong><span>{item.detail}</span></span>
            <Status>{item.status}</Status>
          </Link>)}</div> : <div className="today-v3-calm-state compact"><strong>No active background work.</strong><p>Analysis, generation and publishing work appears here while it is running.</p></div>}
      </section>
    </div>

    <section className="today-v3-section today-v3-upcoming" aria-labelledby="today-coming-up-heading">
      <div className="today-v3-section-heading compact">
        <div><span className="section-label">Next 7 days</span><h2 id="today-coming-up-heading">Coming up</h2></div>
        <Link className="today-v3-secondary-link" href={href("/studio/growth")}>Open Grow</Link>
      </div>
      {comingUp.length ? <div className="today-v3-list">{comingUp.map((item) =>
        <Link className="today-v3-upcoming-row" href={item.href} key={item.id}>
          <time dateTime={item.scheduledAt}>{formatOperatingDateTime(item.scheduledAt, preferences)}</time>
          <span className="today-v3-row-copy"><strong>{item.title}</strong><span>{item.detail}</span></span>
          <span className="today-v3-arrow" aria-hidden>→</span>
        </Link>)}</div> : <div className="today-v3-calm-state compact inline"><strong>The next seven days are clear.</strong><p>Scheduled content and publications will appear here.</p></div>}
    </section>
  </div>;
}
