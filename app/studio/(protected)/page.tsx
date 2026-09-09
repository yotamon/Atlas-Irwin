import Link from "next/link";
import {
  CalmState,
  DecisionQueue,
  DecisionRow,
  PriorityHero,
  SectionHeading,
  type SemanticTone,
} from "@/components/studio/patterns";
import { Page, PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { loadArtistOperatingSnapshot } from "@/lib/studio/artist-operating-snapshot";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { needsYouTone } from "@/lib/studio/needs-you";
import { formatOperatingDateTime } from "@/lib/studio/operating-preferences";

function decisionTone(value: string): SemanticTone {
  if (value === "important") return "danger";
  if (value === "warning") return "attention";
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
  const {
    activeRelease,
    primaryMission,
    needsYou,
    topDecision,
    nextAction,
    nextActionHref,
    humanNextAction,
    humanNextActionHref,
    managerPlan,
    working,
    comingUp,
    preferences,
    operatingContext,
    strategy,
  } = snapshot;

  const handsOff = operatingContext.profile.marketingInvolvement === "just_make_music";
  const missionAction = primaryMission?.nextAction ?? null;
  const visibleMissionAction = handsOff ? null : missionAction;
  const actionableNext = handsOff ? humanNextAction : nextAction;
  const actionableNextHref = handsOff ? humanNextActionHref : nextActionHref;
  const managerLead = managerPlan[0] ?? null;
  const missionDetail = primaryMission
    ? handsOff
      ? `Keep making music. Ensemblis is managing the next moves. ${primaryMission.summary}`
      : primaryMission.summary
    : null;

  const heroTitle = topDecision?.title
    || primaryMission?.title
    || actionableNext?.title
    || (handsOff ? "Keep making music. Ensemblis is managing the next moves." : strategy.recommendedMission.title)
    || "Ensemblis can keep moving without interrupting you";
  const heroDetail = topDecision?.detail
    || missionDetail
    || actionableNext?.rationale
    || (handsOff ? managerLead?.detail || strategy.humanIntervention : strategy.recommendedMission.rationale);
  const heroStatus = topDecision
    ? (topDecision.severity === "required" ? "Required" : "Needs attention")
    : primaryMission
      ? primaryMission.label
      : actionableNext
        ? "Recommended"
        : handsOff
          ? "Manager active"
          : "Clear";
  const heroTone: SemanticTone = topDecision?.severity === "required"
    ? "danger"
    : topDecision
      ? "attention"
      : primaryMission?.status === "blocked"
        ? "danger"
        : primaryMission?.status === "needs_attention"
          ? "attention"
          : primaryMission?.status === "on_track"
            ? "success"
            : primaryMission
              ? "accent"
              : actionableNext
                ? "accent"
                : "success";
  const heroPrimary = topDecision
    ? { href: href(topDecision.href), label: "Resolve this" }
    : visibleMissionAction
      ? { href: href(visibleMissionAction.href), label: visibleMissionAction.title }
      : primaryMission
        ? handsOff
          ? { href: "#ensemblis-handling", label: "See what Ensemblis is handling" }
          : { href: href(primaryMission.href), label: "Open Mission" }
        : actionableNext && actionableNextHref
          ? { href: actionableNextHref, label: "Act on this" }
          : handsOff
            ? { href: "#ensemblis-handling", label: "See what Ensemblis is handling" }
            : { href: href(strategy.recommendedMission.href), label: "Open recommended Mission" };

  const remainingDecisions = topDecision
    ? needsYou.filter((item) => item.id !== topDecision.id)
    : needsYou;
  const decisionPreview = topDecision ? remainingDecisions.slice(0, 3) : needsYou.slice(0, 3);
  const handling = [
    ...working.map((item) => ({ ...item, activity: "Working now" })),
    ...managerPlan.map((item) => ({ ...item, activity: "Planned" })),
  ].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 6);
  const contextCount = remainingDecisions.length + handling.length + comingUp.length;

  return (
    <Page className="ensemblis-today-page">
      <PageHeader
        eyebrow="Artist operating view"
        title="Today"
        description={`One clear next move for ${artist.artistName}. Background work stays collapsed until you want it.`}
        action={<Link className="button ghost" href={href("/studio/settings/artist")}>Working profile</Link>}
      />

      <PriorityHero
        eyebrow={topDecision
          ? "Needs You"
          : primaryMission
            ? primaryMission.kind === "release" && activeRelease
              ? `${activeRelease.title} · ${primaryMission.label}`
              : `Primary Mission · ${primaryMission.label}`
            : handsOff
              ? "Manager mode"
              : "Recommended next move"}
        title={heroTitle}
        description={heroDetail}
        status={heroStatus}
        tone={heroTone}
        actions={<>
          <Link className="button primary" href={heroPrimary.href}>{heroPrimary.label}</Link>
          {topDecision
            ? remainingDecisions.length
              ? <Link href="#ensemblis-handling">{remainingDecisions.length} more decision{remainingDecisions.length === 1 ? "" : "s"}</Link>
              : <Link href={href("/studio/needs-you")}>Decision history</Link>
            : primaryMission?.kind === "release" && activeRelease
              ? <Link href={href(`/studio/releases/${activeRelease.id}`)}>View release Mission</Link>
              : <Link href={href("/studio/growth/strategy")}>Why this strategy?</Link>}
        </>}
      />

      <details className="today-v3-context" id="ensemblis-handling">
        <summary>
          <span>
            <strong>Everything else today</strong>
            <small>Decisions, background work and the next seven days</small>
          </span>
          <Status>{contextCount ? `${contextCount} items` : "Clear"}</Status>
        </summary>

        <div className="today-v3-context-body">
          <div className="today-v3-two-column ensemblis-today-focus-grid">
            <DecisionQueue
              eyebrow="Only when your judgment matters"
              title={topDecision ? "Other decisions" : "Needs You"}
              count={remainingDecisions.length}
              action={<Link href={href("/studio/needs-you")}>Open queue</Link>}
            >
              {decisionPreview.length ? decisionPreview.map((item) =>
                <DecisionRow
                  href={href(item.href)}
                  key={item.id}
                  meta={item.severity === "required" ? "Required" : item.category}
                  title={item.title}
                  description={item.detail}
                  tone={decisionTone(needsYouTone(item))}
                />
              ) : <CalmState title="No other decisions need you." body={handsOff ? "Keep making music. Ensemblis will bring back only decisions that genuinely need you." : "Approvals and ambiguous decisions appear here only when needed."} />}
              {remainingDecisions.length > decisionPreview.length ? <Link className="en-decision-more" href={href("/studio/needs-you")}>View {remainingDecisions.length - decisionPreview.length} more decision{remainingDecisions.length - decisionPreview.length === 1 ? "" : "s"}</Link> : null}
            </DecisionQueue>

            <section className="today-v3-section" aria-labelledby="today-handling-heading">
              <SectionHeading
                id="today-handling-heading"
                eyebrow="Behind the scenes"
                title="Ensemblis is handling"
                compact
                action={<span className={`today-v3-count${handling.length ? " is-working" : ""}`}>{handling.length}</span>}
              />
              {handling.length ? <div className="today-v3-list">{handling.map((item) =>
                <Link className="today-v3-work-row" href={item.href} key={item.id}>
                  <span className="today-v3-working-dot" aria-hidden />
                  <span className="today-v3-row-copy"><strong>{item.title}</strong><span>{item.detail}</span></span>
                  <Status>{item.activity}</Status>
                </Link>)}</div> : <CalmState title="Nothing is running right now." body="Ensemblis will add the next evidence-backed action when the artist context changes." />}
            </section>
          </div>

          <section className="today-v3-section today-v3-upcoming" aria-labelledby="today-coming-up-heading">
            <SectionHeading
              id="today-coming-up-heading"
              eyebrow="Next 7 days"
              title="Coming up"
              compact
              action={<Link href={href("/studio/growth")}>Open Grow</Link>}
            />
            {comingUp.length ? <div className="today-v3-list">{comingUp.map((item) =>
              <Link className="today-v3-upcoming-row" href={item.href} key={item.id}>
                <time dateTime={item.scheduledAt}>{formatOperatingDateTime(item.scheduledAt, preferences)}</time>
                <span className="today-v3-row-copy"><strong>{item.title}</strong><span>{item.detail}</span></span>
                <span className="today-v3-arrow" aria-hidden>→</span>
              </Link>)}</div> : <CalmState inline title="The next seven days are clear." body="Scheduled content and publications will appear here." />}
          </section>
        </div>
      </details>
    </Page>
  );
}
