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
  const {
    activeRelease,
    activeMission,
    needsYou,
    topDecision,
    nextAction,
    nextActionHref,
    working,
    comingUp,
    preferences,
  } = snapshot;

  return <div className="studio-v2-page ensemblis-today-v3">
    <PageHeader
      title="Today"
      description={`A calm command center for ${artist.artistName}. See the active Mission, what Ensemblis is doing, and only the decisions that need you.`}
      action={needsYou.length ? <Link className="button primary" href={href("/studio/needs-you")}>Needs you ({needsYou.length})</Link> : undefined}
    />

    {activeRelease && activeMission ? <section className="today-v3-next" aria-labelledby="today-mission-heading">
      <div className="today-v3-section-heading">
        <div><span className="section-label">Active release Mission</span><h2 id="today-mission-heading">{activeRelease.title}</h2></div>
        <Status>{activeMission.label}</Status>
      </div>
      <p>{activeMission.summary}</p>
      <div className="actions">
        {activeMission.nextAction
          ? <Link className="button primary" href={href(activeMission.nextAction.href)}>{activeMission.nextAction.title}</Link>
          : <Link className="button primary" href={href(`/studio/releases/${activeRelease.id}`)}>Open Mission</Link>}
        <Link className="today-v3-secondary-link" href={href(`/studio/releases/${activeRelease.id}`)}>View release Mission</Link>
      </div>
    </section> : null}

    <section className="today-v3-next" aria-labelledby="today-next-heading">
      <div className="today-v3-section-heading">
        <div>
          <span className="section-label">Recommended next move</span>
          <h2 id="today-next-heading">{topDecision?.title || nextAction?.title || "Ensemblis can keep moving without interrupting you"}</h2>
        </div>
        <Status>{topDecision ? (topDecision.severity === "required" ? "Required" : "Needs attention") : nextAction ? "Recommended" : "Clear"}</Status>
      </div>
      {topDecision ? <>
        <p>{topDecision.detail}</p>
        <div className="actions">
          <Link className="button primary" href={href(topDecision.href)}>Resolve this</Link>
          <Link className="today-v3-secondary-link" href={href("/studio/needs-you")}>Open decision queue</Link>
        </div>
      </> : nextAction && nextActionHref ? <>
        <p>{nextAction.rationale}</p>
        <div className="actions">
          <Link className="button primary" href={nextActionHref}>Act on this</Link>
          <Link className="today-v3-secondary-link" href={href("/studio/growth")}>Inspect evidence</Link>
        </div>
      </> : <div className="today-v3-calm-state">
        <strong>No higher-leverage human intervention is currently ranked.</strong>
        <p>Ensemblis will continue safe internal work and surface anything that requires judgment or an external effect.</p>
      </div>}
    </section>

    <div className="today-v3-two-column">
      <section className="today-v3-section" aria-labelledby="today-needs-you-heading">
        <div className="today-v3-section-heading compact">
          <div><span className="section-label">Decision queue</span><h2 id="today-needs-you-heading">Needs you</h2></div>
          <div className="actions">
            <span className={`today-v3-count${needsYou.length ? " has-items" : ""}`}>{needsYou.length}</span>
            <Link className="today-v3-secondary-link" href={href("/studio/needs-you")}>Open queue</Link>
          </div>
        </div>
        {needsYou.length ? <div className="today-v3-list">{needsYou.map((item) =>
          <Link className={`today-v3-row ${needsYouTone(item)}`} href={href(item.href)} key={item.id}>
            <span className="today-v3-row-copy">
              <small>{item.category} · {item.severity}</small>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </span>
            <span className="today-v3-arrow" aria-hidden>→</span>
          </Link>)}</div> : <div className="today-v3-calm-state compact">
          <strong>Nothing needs your judgment right now.</strong>
          <p>Approvals, ambiguity and important decisions appear here from one canonical queue.</p>
        </div>}
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
          </Link>)}</div> : <div className="today-v3-calm-state compact">
          <strong>No active background work.</strong>
          <p>Analysis, generation and publishing work will appear here when it is actually running.</p>
        </div>}
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
        </Link>)}</div> : <div className="today-v3-calm-state compact inline">
        <strong>The next seven days are clear.</strong>
        <p>Scheduled content and publications will appear here.</p>
      </div>}
    </section>
  </div>;
}
