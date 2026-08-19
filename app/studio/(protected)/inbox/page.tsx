import Link from "next/link";
import { approveInboxBatch, rejectInboxBatch } from "@/app/studio/inbox-actions-v2";
import { approveOutreachDrafts, rejectOutreachDrafts } from "@/app/studio/outreach-actions-v2";
import { PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { outreachCapability } from "@/lib/marketing/outreach-delivery";

const SAFE_INTERNAL_AUTOMATION = new Set(["generate_winner_derivatives", "evaluate_experiment", "collect_metrics"]);

function shortDate(value: string | null) {
  if (!value) return "As soon as approved";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(new Date(value));
}

export default async function InboxPage() {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const [publicationResult, automationResult, outreachResult] = await Promise.all([
    marketing.from("publication_jobs").select("*").eq("owner_id", user.id).eq("status", "awaiting_approval").order("scheduled_at", { ascending: true }),
    marketing.from("automation_jobs").select("*").eq("owner_id", user.id).eq("status", "awaiting_approval").order("run_after", { ascending: true }),
    marketing.from("outreach_messages").select("id,contact_id,channel,message,release_id,campaign_id,response_status").eq("owner_id", user.id).is("sent_at", null).eq("response_status", "Draft").order("created_at", { ascending: true }),
  ]);
  const error = [publicationResult, automationResult, outreachResult].find((result) => result.error)?.error;
  if (error) throw new Error(error.message);

  const publications = publicationResult.data ?? [];
  const automation = automationResult.data ?? [];
  const outreach = outreachResult.data ?? [];
  const contactIds = [...new Set(outreach.map((message) => message.contact_id))];
  const { data: contacts, error: contactError } = contactIds.length
    ? await supabase.from("outreach_contacts").select("id,name").eq("owner_id", user.id).in("id", contactIds)
    : { data: [], error: null };
  if (contactError) throw new Error(contactError.message);
  const contactById = new Map((contacts ?? []).map((contact) => [contact.id, contact.name]));

  const safeAutomation = automation.filter((job) => SAFE_INTERNAL_AUTOMATION.has(job.job_type));
  const protectedAutomation = automation.filter((job) => !SAFE_INTERNAL_AUTOMATION.has(job.job_type));
  const batchCount = publications.length + safeAutomation.length;

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Needs you"
        description="One review surface for external effects, paid/high-impact work and ambiguous decisions. Safe internal work never asks for permission."
        action={<Link className="button" href="/studio">Back to Today</Link>}
      />

      {batchCount ? (
        <form className="v2-section" action={approveInboxBatch}>
          <div className="v2-section-heading">
            <div><span className="section-label">Workflow approval</span><h2>{batchCount} decision{batchCount === 1 ? "" : "s"} ready</h2></div>
            <div className="v2-approval-impact"><strong>$0 estimated AI cost</strong><span>{publications.length} external publish action{publications.length === 1 ? "" : "s"}</span></div>
          </div>
          <p className="v2-muted-copy">Everything selected below is either a free internal automation or an external publication you are explicitly authorizing. Paid generation is never included in this batch.</p>
          <div className="v2-approval-list">
            {publications.map((job) => (
              <label key={job.id}>
                <input type="checkbox" name="publication_id" value={job.id} defaultChecked />
                <div><Status>Publish</Status><strong>{job.platform}</strong><small>{shortDate(job.scheduled_at)} · external effect</small></div>
              </label>
            ))}
            {safeAutomation.map((job) => (
              <label key={job.id}>
                <input type="checkbox" name="automation_id" value={job.id} defaultChecked />
                <div><Status>Internal</Status><strong>{job.job_type.replaceAll("_", " ")}</strong><small>Free, reversible workflow automation</small></div>
              </label>
            ))}
          </div>
          <div className="actions">
            <button className="button primary" type="submit">Approve selected</button>
            <button className="button" type="submit" formAction={rejectInboxBatch}>Reject selected</button>
          </div>
        </form>
      ) : null}

      {outreach.length ? (
        <form className="v2-section" action={approveOutreachDrafts}>
          <div className="v2-section-heading">
            <div><span className="section-label">Outreach approval</span><h2>{outreach.length} message{outreach.length === 1 ? "" : "s"} prepared</h2></div>
            <div className="v2-approval-impact"><strong>$0 AI cost</strong><span>External send requires this approval</span></div>
          </div>
          <div className="v2-outreach-approval-list">
            {outreach.map((message) => {
              const capability = outreachCapability(message.channel);
              return (
                <label key={message.id}>
                  <input type="checkbox" name="outreach_id" value={message.id} defaultChecked />
                  <div>
                    <div><Status>{message.channel}</Status><strong>{contactById.get(message.contact_id) || "Contact"}</strong></div>
                    <p>{message.message}</p>
                    <small>{capability.automatedSending ? "Connected delivery: approval sends now" : "No delivery adapter: approval prepares a manual handoff"}</small>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="actions">
            <button className="button primary" type="submit">Approve selected outreach</button>
            <button className="button" type="submit" formAction={rejectOutreachDrafts}>Reject selected</button>
          </div>
        </form>
      ) : null}

      {!batchCount && !outreach.length ? (
        <section className="v2-section"><div className="v2-calm-state compact"><strong>Nothing is waiting for approval.</strong><p>Atlas can keep working without interrupting you.</p></div></section>
      ) : null}

      {protectedAutomation.length ? (
        <section className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">Protected actions</span><h2>Review individually</h2></div><span className="v2-count has-items">{protectedAutomation.length}</span></div>
          <p className="v2-muted-copy">These job types are not on the safe internal allow-list. Atlas refuses to batch-approve an unknown paid or high-impact operation.</p>
          <div className="v2-inbox">
            {protectedAutomation.map((job) => (
              <Link className="v2-inbox-item important" href={job.campaign_id ? `/studio/campaigns/${job.campaign_id}` : "/studio/campaigns"} key={job.id}>
                <div><span>Individual approval</span><strong>{job.job_type.replaceAll("_", " ")}</strong><small>Open the campaign to inspect cost and impact.</small></div><b aria-hidden>→</b>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
