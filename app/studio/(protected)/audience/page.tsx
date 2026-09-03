import Link from "next/link";
import { approveAudienceReply, ignoreAudienceInteraction, syncAudienceNow } from "@/app/studio/audience-actions";
import { PageHeader, Status } from "@/components/studio/ui";
import { createAutonomyServiceClient } from "@/lib/marketing/autonomy-db";
import { requireArtistContext } from "@/lib/studio/artist-context";

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}

export default async function AudiencePage() {
  const artist = await requireArtistContext();
  const db = createAutonomyServiceClient();
  const { data, error } = await db.from("audience_interactions")
    .select("*")
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .not("status", "in", "(ignored,replied)")
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  const interactions = data ?? [];
  const ready = interactions.filter((item) => item.suggested_reply);

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Audience"
        description={`Comments and conversations that deserve a human ${artist.artistName} response. Ensemblis drafts; you decide what leaves the Studio.`}
        action={<div className="actions"><form action={syncAudienceNow}><button className="button" type="submit">Sync now</button></form><Link className="button" href="/studio">Back to Today</Link></div>}
      />

      <section className="v2-section">
        <div className="v2-section-heading">
          <div><span className="section-label">Community signal</span><h2>{interactions.length ? `${interactions.length} conversation${interactions.length === 1 ? "" : "s"}` : "Inbox is clear"}</h2></div>
          <span className={`v2-count${ready.length ? " has-items" : ""}`}>{ready.length} drafted</span>
        </div>
        <p className="v2-muted-copy">Replies are never auto-sent. Collaboration, booking, rights, money, criticism and ambiguous messages always stay under human review.</p>

        {interactions.length ? (
          <div className="v2-inbox">
            {interactions.map((item) => (
              <article className="v2-inbox-item" key={item.id}>
                <div style={{ width: "100%" }}>
                  <div className="actions">
                    <Status>{item.platform}</Status>
                    <Status>{item.sentiment || "unclassified"}</Status>
                    <small>{shortDate(item.occurred_at)}</small>
                  </div>
                  <strong>{item.author_name || item.author_handle || "Listener"}</strong>
                  <p>{item.body}</p>
                  {item.suggested_reply ? (
                    <form action={approveAudienceReply}>
                      <input type="hidden" name="id" value={item.id} />
                      <label>
                        <small>Ensemblis draft</small>
                        <textarea name="reply" defaultValue={item.suggested_reply} rows={3} maxLength={1000} required />
                      </label>
                      <div className="actions">
                        <button className="button primary" type="submit">Approve & reply</button>
                        <button className="button" type="submit" formAction={ignoreAudienceInteraction}>Ignore</button>
                      </div>
                    </form>
                  ) : (
                    <form action={ignoreAudienceInteraction}>
                      <input type="hidden" name="id" value={item.id} />
                      <button className="button" type="submit">Ignore</button>
                    </form>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="v2-calm-state compact"><strong>No audience messages need you.</strong><p>Ensemblis will keep listening to connected channels for {artist.artistName}.</p></div>
        )}
      </section>
    </div>
  );
}
