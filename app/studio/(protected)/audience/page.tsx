import Link from "next/link";
import { approveAudienceReply, ignoreAudienceInteraction, syncAudienceNow } from "@/app/studio/audience-actions";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { loadFanGraphSummary } from "@/lib/audience/fan-graph-server";
import { createAutonomyServiceClient } from "@/lib/marketing/autonomy-db";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(new Date(value));
}

function readable(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export default async function AudiencePage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const db = createAutonomyServiceClient();
  const [interactionsResult, fanGraph] = await Promise.all([
    db.from("audience_interactions").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).not("status", "in", "(ignored,replied)").order("occurred_at", { ascending: false }).limit(100),
    loadFanGraphSummary(supabase, user.id, artist.artistId),
  ]);
  if (interactionsResult.error) throw new Error(interactionsResult.error.message);
  const interactions = interactionsResult.data ?? [];
  const ready = interactions.filter((item) => item.suggested_reply);
  const reviewOnly = interactions.filter((item) => !item.suggested_reply);
  const ordered = [...ready, ...reviewOnly];
  const recentRelationships = fanGraph.profiles.filter((profile) => profile.qualityBand !== "inactive").slice(0, 10);

  return (
    <div className="studio-v2-page audience-polish-page">
      <PageHeader title="Audience" description={`Fan quality, relationships and conversations that matter for ${artist.artistName}.`} />

      <section className="audience-polish-summary fan-graph-summary" aria-label="Fan quality summary">
        <div><strong>{interactions.length}</strong><span>need judgment</span></div>
        <div><strong>{fanGraph.qualifiedFanCount}</strong><span>qualified fans</span></div>
        <div><strong>{fanGraph.coreFanCount}</strong><span>core fans</span></div>
        <div><strong>{fanGraph.ownedReachableCount}</strong><span>directly reachable</span></div>
        <p>{percent(fanGraph.repeatRelationshipRate)} of active relationships show repeat engagement. These are evidence bands, not a universal fan score: Ensemblis keeps discovery, fandom and permissioned reach separate and never infers consent.</p>
      </section>

      <section className="fan-graph-section">
        <div className="audience-polish-heading fan-graph-heading">
          <div><span className="section-label">Fan quality intelligence</span><h2>{recentRelationships.length ? `${recentRelationships.length} recent relationship${recentRelationships.length === 1 ? "" : "s"}` : "Relationships will appear as conversations arrive"}</h2></div>
          <span>{fanGraph.activeRelationshipCount} active · {fanGraph.engagedFanCount} engaged</span>
        </div>
        {recentRelationships.length ? <div className="fan-relationship-list">
          {recentRelationships.map((profile) => <Link href={`/studio/audience/fans/${profile.id}`} className="fan-relationship-row" key={profile.id}>
            <div className="fan-relationship-person"><strong>{profile.displayName}</strong><span>{readable(profile.qualityBand, "New")} fan · {profile.interactionCount} interaction{profile.interactionCount === 1 ? "" : "s"}</span></div>
            <div className="fan-channel-chips">{profile.identities.slice(0, 4).map((identity) => <span key={identity.id}>{readable(identity.channel, "Channel")} · {identity.label}</span>)}</div>
            <div className="fan-relationship-context"><span>{profile.qualityReasons.slice(0, 2).join(" · ")}</span>{profile.nextAction ? <strong>{profile.nextAction.title}</strong> : <small>{profile.ownedReachable ? "Permissioned direct relationship" : `Last seen ${shortDate(profile.lastSeenAt)}`}</small>}</div>
          </Link>)}
        </div> : <div className="v2-calm-state compact"><strong>No relationship history yet.</strong><p>Ensemblis will distinguish attention from repeat fandom as real first-party evidence arrives, without guessing identities across platforms.</p></div>}
      </section>

      <section className="audience-polish-queue">
        <div className="audience-polish-heading"><div><span className="section-label">Needs judgment</span><h2>{interactions.length ? `${interactions.length} conversation${interactions.length === 1 ? "" : "s"}` : "Inbox is clear"}</h2></div><span>{ready.length} safe draft{ready.length === 1 ? "" : "s"} prepared</span></div>
        {ordered.length ? <div className="audience-thread-list">{ordered.map((item) => (
          <article className="audience-thread" id={`interaction-${item.id}`} key={item.id}>
            <header><div><small>{readable(item.platform, "Channel")} · {shortDate(item.occurred_at)}</small><strong>{item.author_name || item.author_handle || "Listener"}</strong></div><span>{readable(item.sentiment, "Unclassified")}</span></header>
            <p className="audience-message">{item.body}</p>
            {item.suggested_reply ? <form action={approveAudienceReply} className="audience-draft">
              <input type="hidden" name="id" value={item.id} />
              <label><span>Ensemblis draft</span><textarea name="reply" defaultValue={item.suggested_reply} rows={3} maxLength={1000} required /></label>
              <div className="actions"><button className="button primary" type="submit">Approve & reply</button><button className="text-button" type="submit" formAction={ignoreAudienceInteraction}>Ignore</button></div>
            </form> : <form action={ignoreAudienceInteraction} className="audience-no-draft"><input type="hidden" name="id" value={item.id} /><span>No safe reply was drafted. Review the message itself.</span><button className="text-button" type="submit">Ignore</button></form>}
          </article>
        ))}</div> : <div className="v2-calm-state compact"><strong>No audience messages need you.</strong><p>Only conversations worth a decision appear here.</p></div>}
      </section>

      <details className="v2-advanced-disclosure">
        <summary>Advanced data controls</summary>
        <p className="v2-muted-copy">Use this only when you need an immediate conversation refresh.</p>
        <form action={syncAudienceNow}><button className="button" type="submit">Refresh conversations now</button></form>
      </details>
    </div>
  );
}
