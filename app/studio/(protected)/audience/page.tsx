import { approveAudienceReply, ignoreAudienceInteraction, syncAudienceNow } from "@/app/studio/audience-actions";
import { PageHeader } from "@/components/studio/ui";
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

function readable(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  const reviewOnly = interactions.filter((item) => !item.suggested_reply);
  const ordered = [...ready, ...reviewOnly];

  return (
    <div className="studio-v2-page audience-polish-page">
      <PageHeader
        title="Audience"
        description={`Only conversations that may deserve ${artist.artistName}'s attention. Ensemblis can draft, classify and prioritize; nothing is sent without your decision.`}
        action={<form action={syncAudienceNow}><button className="button" type="submit">Sync conversations</button></form>}
      />

      <section className="audience-polish-summary" aria-label="Audience inbox summary">
        <div><strong>{ready.length}</strong><span>drafts ready</span></div>
        <div><strong>{reviewOnly.length}</strong><span>need review</span></div>
        <p>Booking, rights, money, criticism and ambiguous conversations stay human-reviewed by design.</p>
      </section>

      <section className="audience-polish-queue">
        <div className="audience-polish-heading">
          <div><span className="section-label">Needs judgment</span><h2>{interactions.length ? `${interactions.length} conversation${interactions.length === 1 ? "" : "s"}` : "Inbox is clear"}</h2></div>
        </div>

        {ordered.length ? (
          <div className="audience-thread-list">
            {ordered.map((item) => (
              <article className="audience-thread" key={item.id}>
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
                    <label>
                      <span>Ensemblis draft</span>
                      <textarea name="reply" defaultValue={item.suggested_reply} rows={3} maxLength={1000} required />
                    </label>
                    <div className="actions">
                      <button className="button primary" type="submit">Approve & reply</button>
                      <button className="text-button" type="submit" formAction={ignoreAudienceInteraction}>Ignore</button>
                    </div>
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
