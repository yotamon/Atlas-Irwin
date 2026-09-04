/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { approveInboxBatch, rejectInboxBatch } from "@/app/studio/inbox-actions-v2";
import { approveOutreachDrafts, rejectOutreachDrafts } from "@/app/studio/outreach-actions-v2";
import { PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { outreachCapability } from "@/lib/marketing/outreach-delivery";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";

const SAFE_INTERNAL_AUTOMATION = new Set(["generate_winner_derivatives", "evaluate_experiment", "collect_metrics"]);

function shortDate(value: string | null) {
  if (!value) return "As soon as approved";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(new Date(value));
}

function readable(value: string | null | undefined) {
  if (!value) return "Workflow action";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function InboxPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const marketing = asMarketingClient(supabase);
  const operational = asArtistScopedOperationalClient(supabase);
  const [publicationResult, automationResult, outreachResult] = await Promise.all([
    marketing.from("publication_jobs").select("*")
      .eq("owner_id", artist.userId).eq("artist_id", artist.artistId)
      .eq("status", "awaiting_approval").order("scheduled_at", { ascending: true }),
    marketing.from("automation_jobs").select("*")
      .eq("owner_id", artist.userId).eq("artist_id", artist.artistId)
      .eq("status", "awaiting_approval").order("run_after", { ascending: true }),
    marketing.from("outreach_messages").select("id,contact_id,channel,message,release_id,campaign_id,response_status")
      .eq("owner_id", artist.userId).eq("artist_id", artist.artistId)
      .is("sent_at", null).eq("response_status", "Draft").order("created_at", { ascending: true }),
  ]);
  const error = [publicationResult, automationResult, outreachResult].find((result) => result.error)?.error;
  if (error) throw new Error(error.message);

  const publications = publicationResult.data ?? [];
  const automation = automationResult.data ?? [];
  const outreach = outreachResult.data ?? [];
  const publicationContentIds = [...new Set(publications.map((job) => job.content_item_id).filter((value): value is string => Boolean(value)))];
  const contactIds = [...new Set(outreach.map((message) => message.contact_id))];
  const [contentResult, contactsResult] = await Promise.all([
    publicationContentIds.length
      ? marketing.from("content_items").select("id,title,caption,asset_url,format,platform,release_id")
          .eq("owner_id", artist.userId).eq("artist_id", artist.artistId).in("id", publicationContentIds)
      : Promise.resolve({ data: [], error: null }),
    contactIds.length
      ? operational.from("outreach_contacts").select("id,name")
          .eq("owner_id", artist.userId).eq("artist_id", artist.artistId).in("id", contactIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (contentResult.error) throw new Error(contentResult.error.message);
  if (contactsResult.error) throw new Error(contactsResult.error.message);
  const contentById = new Map((contentResult.data ?? []).map((item) => [item.id, item]));
  const contactById = new Map((contactsResult.data ?? []).map((contact) => [contact.id, contact.name]));

  const safeAutomation = automation.filter((job) => SAFE_INTERNAL_AUTOMATION.has(job.job_type));
  const protectedAutomation = automation.filter((job) => !SAFE_INTERNAL_AUTOMATION.has(job.job_type));
  const batchCount = publications.length + safeAutomation.length;

  return (
    <div className="studio-v2-page inbox-polish-page">
      <PageHeader
        title="Needs you"
        description={`Only decisions where ${artist.artistName} needs human judgment. See the effect first, then approve what should leave Ensemblis.`}
        action={<Link className="button" href="/studio">Back to Today</Link>}
      />

      <section className="inbox-impact-strip" aria-label="Approval impact summary">
        <div><strong>{publications.length}</strong><span>public actions</span></div>
        <div><strong>{outreach.length}</strong><span>messages</span></div>
        <div><strong>{protectedAutomation.length}</strong><span>protected</span></div>
        <p>Paid generation never enters a batch approval. Unknown or high-impact automation stays individual.</p>
      </section>

      {batchCount ? (
        <form className="inbox-approval-section" action={approveInboxBatch}>
          <input type="hidden" name="artist_id" value={artist.artistId} />
          <div className="inbox-section-heading">
            <div><span className="section-label">Ready for a decision</span><h2>{batchCount} action{batchCount === 1 ? "" : "s"}</h2></div>
            <div className="inbox-impact-copy"><strong>$0 estimated AI cost</strong><span>{publications.length ? `${publications.length} public publish action${publications.length === 1 ? "" : "s"}` : "Internal work only"}</span></div>
          </div>

          {publications.length ? (
            <div className="inbox-publication-list">
              {publications.map((job) => {
                const content = job.content_item_id ? contentById.get(job.content_item_id) : null;
                const asset = content?.asset_url ?? null;
                const isVideo = Boolean(asset && /\.(mp4|mov|webm)(?:\?|$)/i.test(asset));
                return (
                  <label className="inbox-publication-card" key={job.id}>
                    <input type="checkbox" name="publication_id" value={job.id} defaultChecked />
                    <div className="inbox-publication-preview">
                      {asset ? isVideo ? <video src={asset} muted playsInline preload="metadata" /> : <img src={asset} alt="" /> : <div aria-hidden>{job.platform?.slice(0, 2).toUpperCase() || "↗"}</div>}
                    </div>
                    <div className="inbox-publication-copy">
                      <div><Status>Publish</Status><small>{job.platform} · {shortDate(job.scheduled_at)}</small></div>
                      <strong>{content?.title || `${job.platform} publication`}</strong>
                      <p>{content?.caption || "This approved content item will be handed to the connected publishing provider."}</p>
                      <span><b>What will happen</b> Ensemblis will authorize this exact item for external publishing. Editing after provider scheduling is locked against drift.</span>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : null}

          {safeAutomation.length ? (
            <details className="inbox-internal-work" open={!publications.length}>
              <summary>{safeAutomation.length} safe internal action{safeAutomation.length === 1 ? "" : "s"}</summary>
              <div>
                {safeAutomation.map((job) => (
                  <label key={job.id}>
                    <input type="checkbox" name="automation_id" value={job.id} defaultChecked />
                    <span><strong>{readable(job.job_type)}</strong><small>Free, reversible workflow automation · {shortDate(job.run_after)}</small></span>
                  </label>
                ))}
              </div>
            </details>
          ) : null}

          <div className="inbox-approval-actions">
            <button className="button primary" type="submit">Approve selected</button>
            <button className="text-button" type="submit" formAction={rejectInboxBatch}>Reject selected</button>
          </div>
        </form>
      ) : null}

      {outreach.length ? (
        <form className="inbox-approval-section" action={approveOutreachDrafts}>
          <input type="hidden" name="artist_id" value={artist.artistId} />
          <div className="inbox-section-heading">
            <div><span className="section-label">Outreach</span><h2>{outreach.length} message{outreach.length === 1 ? "" : "s"} prepared</h2></div>
            <div className="inbox-impact-copy"><strong>External communication</strong><span>Read the words before they leave Ensemblis</span></div>
          </div>
          <div className="inbox-outreach-list">
            {outreach.map((message) => {
              const capability = outreachCapability(message.channel);
              return (
                <label key={message.id}>
                  <input type="checkbox" name="outreach_id" value={message.id} defaultChecked />
                  <div>
                    <div><Status>{message.channel}</Status><strong>{contactById.get(message.contact_id) || "Contact"}</strong></div>
                    <p>{message.message}</p>
                    <small>{capability.automatedSending ? "Approval sends this through the connected delivery channel." : "No delivery adapter is connected. Approval prepares a manual handoff only."}</small>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="inbox-approval-actions">
            <button className="button primary" type="submit">Approve selected outreach</button>
            <button className="text-button" type="submit" formAction={rejectOutreachDrafts}>Reject selected</button>
          </div>
        </form>
      ) : null}

      {!batchCount && !outreach.length ? (
        <section className="inbox-clear-state"><strong>Nothing is waiting for approval.</strong><p>Ensemblis can keep working for {artist.artistName} without interrupting you.</p></section>
      ) : null}

      {protectedAutomation.length ? (
        <section className="inbox-protected-section">
          <div className="inbox-section-heading"><div><span className="section-label">Protected actions</span><h2>Review individually</h2></div><span className="v2-count has-items">{protectedAutomation.length}</span></div>
          <p>These job types are not on the safe internal allow-list. Ensemblis refuses to batch-approve an unknown paid or high-impact operation.</p>
          <div className="inbox-protected-list">
            {protectedAutomation.map((job) => (
              <Link href={job.campaign_id ? `/studio/campaigns/${job.campaign_id}` : "/studio/campaigns"} key={job.id}>
                <div><span>Individual approval</span><strong>{readable(job.job_type)}</strong><small>Open the campaign to inspect cost and impact.</small></div><b aria-hidden>→</b>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
