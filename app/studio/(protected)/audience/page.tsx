import Link from "next/link";
import { approveAudienceReply, ignoreAudienceInteraction, syncAudienceNow } from "@/app/studio/audience-actions";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { loadFanGraphSummary } from "@/lib/audience/fan-graph-server";
import { createAutonomyServiceClient } from "@/lib/marketing/autonomy-db";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}

function readable(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function AudiencePage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const db = createAutonomyServiceClient();
  const [interactionsResult, fanGraph] = await Promise.all([
    db.from("audience_interactions")
      .select("*")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .not("status", "in", "(ignored,replied)")
      .order("occurred_at", { ascending: false })
      .limit(100),
    loadFanGraphSummary(supabase, user.id, artist.artistId),
  ]);
  if (interactionsResult.error) throw new Error(interactionsResult.error.message);
  const interactions = interactionsResult.data ?? [];
  const ready = interactions.filter((item) => item.suggested_reply);
  const reviewOnly = interactions.filter((item) => !item.suggested_reply);
  const ordered = [...ready, ...reviewOnly];
  const recentRelationships = fanGraph.profiles.filter((profile) => profile.relationshipState !== "inactive").slice(0, 10);

  return (
    <div className="studio-v2-page audience-polish-page">
      <PageHeader
        title="Audience"
        description={`Relationship memory for ${artist.artistName}, plus only the conversations that need judgment. Channel identities and permissions stay separate unless real evidence connects them.`}
        action={<form action={syncAudienceNow}><button className="button" type="submit">Sync conversations</button></form>}
      />

      <section className="audience-polish-summary fan-graph-summary" aria-label="Audience relationship summary">
        <div><strong>{interactions.length}</strong><span>need judgment</span></div>
        <div><strong>{fanGraph.returningCount}</strong><span>returning relationships</span></div>
        <div><strong>{fanGraph.knownSupporterCount}</strong><span>known supporters</span></div>
        <div><strong>{fanGraph.permissionedIdentityCount}</strong><span>permissioned channel identities</span></div>
        <p>Engagement is not consent. Ensemblis never turns a comment, follow, matching handle, or behavioral similarity into permission to market to someone.</p>
      </section>

      <section className="fan-graph-section">
        <div className="audience-polish-heading fan-graph-heading">
          <div><span className="section-label">Relationship memory</span><h2>{recentRelationships.length ? `${recentRelationships.length} recent relationship${recentRelationships.length === 1 ? "" : "s"}` : "Relationships will appear as conversations arrive"}</h2></div>
          <span>{fanGraph.profiles.length} total active</span>
        </div>
        {recentRelationships.length ? <div className="fan-relationship-list">
          {recentRelationships.map((profile) => <Link href={`/studio/audience/fans/${profile.id}`} className="fan-relationship-row" key={profile.id}>
            <div className="fan-relationship-person"><strong>{profile.displayName}</strong><span>{readable(profile.relationshipState, "New")} · {profile.interactionCount} interaction{profile.interactionCount === 1 ? "" : "s"}</span></div>
            <div className="fan-channel-chips">{profile.identities.slice(0, 4).map((identity) => <span key={identity.id}>{readable(identity.channel, "Channel")} · {identity.label}</span>)}</div>
            <div className="fan-relationship-context"><span>Last seen {shortDate(profile.lastSeenAt)}</span>{profile.nextAction ? <strong>{profile.nextAction.title}</strong> : <small>No action needed</small>}</div>
          </Link>)}
        </div> : <div className="v2-calm-state compact"><strong>No relationship history yet.</strong><p>When the same handle returns on the same connected channel, Ensemblis can remember that channel relationship without pretending to know who they are elsewhere.</p></div>}
      </section>

      <section className="audience-polish-queue">
        <div className="audience-polish-heading">
          <div><span className="section-label">Needs judgment</span><h2>{interactions.length ? `${interactions.length} conversation${interactions.length === 1 ? "" : "s"}` : "Inbox is clear"}</h2></div>
          <span>{ready.length} safe draft{ready.length === 1 ? "" : "s"} prepared</span>
        </div>

        {ordered.length ? (
          <div className="audience-thread-list">
            {ordered.map((item) => (
              <article className="audience-thread" id={`interaction-${item.id}`} key={item.id}>
                <header>
                  <div>
                    <small>{readable(item.platform, "Channel")} · {shortDate(item.occurred_at)}</small>
                    <strong>{item.author_name || item.author_handle || "Listener"}</strong>
                  </div>
                  <span>{readable(item.sentiment, "Unclassified")}</span>
                </header>
                <p className="audience-message">{item.body}</p>

                {item.suggested_reply ? (
                  <form action={approveAudienceReply} className="audience-draft">
                    <input type="hidden" name="id" value={item.id} />
                    <label><span>Ensemblis draft</span><textarea name="reply" defaultValue={item.suggested_reply} rows={3} maxLength={1000} required /></label>
                    <div className="actions"><button className="button primary" type="submit">Approve & reply</button><button className="text-button" type="submit" formAction={ignoreAudienceInteraction}>Ignore</button></div>
                  </form>
                ) : (
                  <form action={ignoreAudienceInteraction} className="audience-no-draft">
                    <input type="hidden" name="id" value={item.id} />
                    <span>No safe reply was drafted. Review the message itself rather than forcing automation.</span>
                    <button className="text-button" type="submit">Ignore</button>
                  </form>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="v2-calm-state compact"><strong>No audience messages need you.</strong><p>Ensemblis will keep listening to connected channels for {artist.artistName} and surface only conversations worth a decision.</p></div>
        )}
      </section>
    </div>
  );
}
