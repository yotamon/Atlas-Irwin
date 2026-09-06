import Link from "next/link";
import { CalmState, DecisionQueue, DecisionRow, PriorityHero, SectionHeading, type SemanticTone } from "@/components/studio/patterns";
import { PageHeader, Status } from "@/components/studio/ui";
import { GOAL_LABELS, MARKETING_INVOLVEMENT_LABELS } from "@/lib/artist-operating/domain";
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
          ? { href: "#manager-plan", label: "View manager plan" }
          : { href: href(primaryMission.href), label: "Open Mission" }
        : actionableNext && actionableNextHref
          ? { href: actionableNextHref, label: "Act on this" }
          : handsOff
            ? { href: "#manager-plan", label: "View manager plan" }
            : { href: href(strategy.recommendedMission.href), label: "Open recommended Mission" };
  const decisionPreview = needsYou.slice(0, 3);

  return <div className="studio-v2-page ensemblis-today-page">
    <PageHeader title="Today" description={`What matters now for ${artist.artistName}.`} />

    <PriorityHero
      eyebrow={primaryMission
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
          ? <Link href={href("/studio/needs-you")}>Open decision queue</Link>
          : primaryMission?.kind === "release" && activeRelease
            ? <Link href={href(`/studio/releases/${activeRelease.id}`)}>View release Mission</Link>
            : <Link href={href("/studio/growth/strategy")}>Why this strategy?</Link>}
      </>}
    />

    <section className="v2-section v2-compact-section">
      <div className="v2-section-heading compact">
        <div>
          <span className="section-label">Artist operating mode</span>
          <h2>{operatingContext.profileConfigured ? `${MARKETING_INVOLVEMENT_LABELS[operatingContext.profile.marketingInvolvement]} · ${GOAL_LABELS[operatingContext.profile.primaryGoal]}` : "Make Ensemblis fit the artist"}</h2>
          <p>{operatingContext.profileConfigured ? strategy.humanIntervention : "Choose how much marketing you want to handle. Ensemblis uses conservative defaults until you confirm the working relationship."}</p>
        </div>
        <Status>{operatingContext.profileConfigured ? "Configured" : "Needs setup"}</Status>
      </div>
      <div className="actions"><Link className={operatingContext.profileConfigured ? "button" : "button primary"} href={href("/studio/settings/artist")}>{operatingContext.profileConfigured ? "Edit working profile" : "Choose working mode"}</Link><Link className="button" href={href("/studio/growth/strategy")}>Artist strategy</Link></div>
    </section>

    <section className="today-v3-section" id="manager-plan" aria-labelledby="today-manager-plan-heading">
      <SectionHeading
        id="today-manager-plan-heading"
        eyebrow={handsOff ? "Ensemblis is handling" : "Planned work"}
        title={handsOff ? "Manager plan" : "This week's plan"}
        compact
        action={<span className="today-v3-count">{managerPlan.length}</span>}
      />
      {managerPlan.length ? <div className="today-v3-list">{managerPlan.map((item) =>
        <Link className="today-v3-work-row" href={item.href} key={item.id}>
          <span className="today-v3-working-dot" aria-hidden />
          <span className="today-v3-row-copy"><strong>{item.title}</strong><span>{item.detail}</span></span>
          <Status>{item.status}</Status>
        </Link>)}</div> : <CalmState title="No manager work is queued right now." body="Ensemblis will add the next evidence-backed move here when the artist context changes." />}
    </section>

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
        ) : <CalmState title="Nothing needs your judgment right now." body={handsOff ? "Keep making music. Ensemblis will prepare safe marketing work and bring back only the decisions that genuinely need you." : "Approvals, ambiguity and important decisions appear here only when needed."} />}
        {needsYou.length > decisionPreview.length ? <Link className="en-decision-more" href={href("/studio/needs-you")}>View {needsYou.length - decisionPreview.length} more decision{needsYou.length - decisionPreview.length === 1 ? "" : "s"}</Link> : null}
      </DecisionQueue>

      <section className="today-v3-section" aria-labelledby="today-working-heading">
        <SectionHeading
          id="today-working-heading"
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
      <SectionHeading id="today-coming-up-heading" eyebrow="Next 7 days" title="Coming up" compact action={<Link href={href("/studio/growth")}>Open Grow</Link>} />
      {comingUp.length ? <div className="today-v3-list">{comingUp.map((item) =>
        <Link className="today-v3-upcoming-row" href={item.href} key={item.id}>
          <time dateTime={item.scheduledAt}>{formatOperatingDateTime(item.scheduledAt, preferences)}</time>
          <span className="today-v3-row-copy"><strong>{item.title}</strong><span>{item.detail}</span></span>
          <span className="today-v3-arrow" aria-hidden>→</span>
        </Link>)}</div> : <CalmState inline title="The next seven days are clear." body="Scheduled content and publications will appear here." />}
    </section>
  </div>;
}
