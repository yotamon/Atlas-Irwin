import Link from "next/link";
import { refreshArtistStrategyAction } from "@/app/studio/artist-operating-actions";
import { PageHeader, Status } from "@/components/studio/ui";
import { GOAL_LABELS, MARKETING_INVOLVEMENT_LABELS } from "@/lib/artist-operating/domain";
import { loadArtistOperatingContext } from "@/lib/artist-operating/server";
import { buildArtistStrategy } from "@/lib/artist-operating/strategy";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function ArtistStrategyPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const context = await loadArtistOperatingContext({ db: supabase, artist });
  const strategy = buildArtistStrategy(context);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Artist strategy"
        description={`A structured, evidence-aware growth direction for ${artist.artistName}. Strategy follows the artist; it does not turn the artist into a marketer.`}
        action={<Link className="button" href={href("/studio/growth")}>Back to Grow</Link>}
      />

      {!context.profileConfigured ? <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Needs one decision</span><h2>Choose how Ensemblis should work for this artist</h2><p>The strategy below uses conservative defaults until the artist operating profile is confirmed.</p></div><Status>Defaults</Status></div>
        <Link className="button primary" href={href("/studio/settings/artist")}>Set artist operating profile</Link>
      </section> : null}

      <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Current focus</span><h2>{strategy.growthFocus}</h2><p>{strategy.positioning}</p></div><Status>{GOAL_LABELS[context.profile.primaryGoal]}</Status></div>
        <div className="v2-settings-grid">
          <article><div><strong>Working mode</strong></div><p>{MARKETING_INVOLVEMENT_LABELS[context.profile.marketingInvolvement]}</p><small>{strategy.humanIntervention}</small></article>
          <article><div><strong>Recommended Mission</strong></div><p>{strategy.recommendedMission.title}</p><small>{strategy.recommendedMission.rationale}</small><Link href={href(strategy.recommendedMission.href)}>Open next step →</Link></article>
          <article><div><strong>Scene</strong></div><p>{context.scene.primaryScene || "Not explicitly set yet"}</p><small>{context.scene.subScenes.length ? context.scene.subScenes.join(" · ") : "Ensemblis will not invent scene relationships without evidence."}</small></article>
        </div>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Content</span><h2>Source-first creative strategy</h2><p>{strategy.contentStrategy.principle}</p></div></div>
        <ol className="v2-learning-list">{strategy.contentStrategy.preferredSources.map((source) => <li key={source}><strong>{source}</strong></li>)}</ol>
      </section>

      <div className="today-v3-two-column">
        <section className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">Channels</span><h2>Where to focus</h2></div></div>
          <div className="v2-learning-list">{strategy.channelPriorities.map((channel) => <div key={channel}><strong>{channel}</strong></div>)}</div>
          <p className="v2-muted-copy">{strategy.releaseStrategy}</p>
        </section>
        <section className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">Outreach</span><h2>Scene before spam</h2></div></div>
          <p>{strategy.outreachStrategy}</p>
          <Link className="button" href={href("/studio/outreach")}>Open Outreach</Link>
        </section>
      </div>

      <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Scene Intelligence</span><h2>Evidence-backed ecosystem relationships</h2><p>Only relationships with usable evidence and sufficient confidence are surfaced here.</p></div><Status>{context.relationships.length ? `${context.relationships.length} usable` : "No named targets yet"}</Status></div>
        {context.relationships.length ? <div className="v2-learning-list">{context.relationships.map((relationship) => <article className="v2-section v2-compact-section" key={relationship.id}><div className="v2-section-heading compact"><div><span className="section-label">{titleCase(relationship.type)}</span><h2>{relationship.targetName}</h2></div><Status>{relationship.fitScore}% fit · {Math.round(relationship.confidence * 100)}% confidence</Status></div><p className="v2-muted-copy">Evidence stored from {Object.keys(relationship.evidence).length} structured field{Object.keys(relationship.evidence).length === 1 ? "" : "s"}. External outreach still follows the artist autonomy contract.</p></article>)}</div> : <div className="v2-calm-state compact"><strong>No invented shortlist.</strong><p>Ensemblis knows the scene context but will wait for verified roster, playlist, channel, promoter, festival or community evidence before naming a target.</p></div>}
      </section>

      <section className="v2-section v2-compact-section">
        <div className="v2-section-heading"><div><span className="section-label">Guardrails</span><h2>What Ensemblis should not do</h2></div></div>
        <ul className="v2-learning-list">{strategy.dontDo.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>

      <div className="actions"><form action={refreshArtistStrategyAction}><button className="button primary" type="submit">Refresh strategy from current evidence</button></form><Link className="button" href={href("/studio/settings/artist")}>Edit operating profile</Link></div>
    </div>
  );
}
