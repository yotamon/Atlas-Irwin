import Link from "next/link";
import { CalmState, DecisionQueue, DecisionRow, PriorityHero, SectionHeading, type SemanticTone } from "@/components/studio/patterns";
import { PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { loadArtistOperatingSnapshot } from "@/lib/studio/artist-operating-snapshot";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { needsYouTone } from "@/lib/studio/needs-you";
import { formatOperatingDateTime } from "@/lib/studio/operating-preferences";

function decisionTone(value: string): SemanticTone {
  if (value === "warning") return "danger";
  if (value === "important") return "attention";
  return "neutral";
}

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
  const heroTone: SemanticTone = topDecision?.severity === "required" ? "danger" : topDecision ? "attention" : missionAction || nextAction ? "accent" : "success";
  const heroPrimary = topDecision
    ? { href: href(topDecision.href), label: "Resolve this" }
    : missionAction
      ? { href: href(missionAction.href), label: missionAction.title }
      : nextAction && nextActionHref
        ? { href: nextActionHref, label: "Act on this" }
        : null;
  const decisionPreview = needsYou.slice(0, 3);

  return <div className="studio-v2-page ensemblis-today-page">
    <PageHeader title="Today" description={`What matters now for ${artist.artistName}.`} />

    <PriorityHero
      eyebrow={activeRelease && activeMission ? `${activeRelease.title} · ${activeMission.label}` : "Recommended next move"}
      title={heroTitle}
      description={heroDetail}
      status={heroStatus}
      tone={heroTone}
      actions={heroPrimary || activeRelease || topDecision || nextAction ? <>
        {heroPrimary ? <Link className="button primary" href={heroPrimary.href}>{heroPrimary.label}</Link> : null}
        {activeRelease
          ? <Link href={href(`/studio/releases/${activeRelease.id}`)}>View release Mission</Link>
          : topDecision
            ? <Link href={href("/studio/needs-you")}>Open decision queue</Link>
            : nextAction
              ? <Link href={href("/studio/growth")}>Inspect evidence</Link>
              : null}
      </> : undefined}
    />

    <div className="today-v3-two-column">
      <DecisionQueue
        eyebrow="Decision queue"
        title="Needs You"
        count={needsYou.length}
        action={<Link href={href("/studio/needs-you")}>Open queue</Link>}
      >
        {decisionPreview.length ? decisionPreview.map((item) =>
          <DecisionRow
            href={href(item.href)}
            key={item.id}
            meta={`${item.category} · ${item.severity}`}
            title={item.title}
            description={item.detail}
            tone={decisionTone(needsYouTone(item))}
          />
        ) : <CalmState title="Nothing needs your judgment right now." body="Approvals, ambiguity and important decisions appear here only when needed." />}
        {needsYou.length > decisionPreview.length ? <Link className="en-decision-more" href={href("/studio/needs-you")}>View {needsYou.length - decisionPreview.length} more decision{needsYou.length - decisionPreview.length === 1 ? "" : "s"}</Link> : null}
      </DecisionQueue>

      <section className="today-v3-section" aria-labelledby="today-working-heading">
        <SectionHeading
          eyebrow="Autonomous work"
          title="Working"
          compact
          action={<span className={`today-v3-count${working.length ? " is-working" : ""}`}>{working.length}</span>}
        />
        {working.length ? <div className="today-v3-list">{working.map((item) =>
          <Link className="today-v3-work-row" href={item.href} key={item.id}>
            <span className="today-v3-working-dot" aria-hidden />
            <span className="today-v3-row-copy"><strong>{item.title}</strong><span>{item.detail}</span></span>
            <Status>{item.status}</Status>
          </Link>)}</div> : <CalmState title="No active background work." body="Analysis, generation and publishing work appears here while it is running." />}
      </section>
    </div>

    <section className="today-v3-section today-v3-upcoming" aria-labelledby="today-coming-up-heading">
      <SectionHeading eyebrow="Next 7 days" title="Coming up" compact action={<Link href={href("/studio/growth")}>Open Grow</Link>} />
      {comingUp.length ? <div className="today-v3-list">{comingUp.map((item) =>
        <Link className="today-v3-upcoming-row" href={item.href} key={item.id}>
          <time dateTime={item.scheduledAt}>{formatOperatingDateTime(item.scheduledAt, preferences)}</time>
          <span className="today-v3-row-copy"><strong>{item.title}</strong><span>{item.detail}</span></span>
          <span className="today-v3-arrow" aria-hidden>→</span>
        </Link>)}</div> : <CalmState inline title="The next seven days are clear." body="Scheduled content and publications will appear here." />}
    </section>
  </div>;
}
