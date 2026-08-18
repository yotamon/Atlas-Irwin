import Link from "next/link";
import { saveContact, saveOutreachMessage } from "@/app/studio/actions";
import {
  createOutreachSequence,
  enrollOutreachContact,
  markSequenceMessageSent,
  updateOutreachSequenceStatus,
} from "@/app/studio/outreach-sequence-actions";
import { CopyButton } from "@/components/studio/copy-button";
import {
  EmptyState,
  Field,
  PageHeader,
  Status,
  Submit,
} from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { CONTACT_TYPES, RELATIONSHIP_STATUSES } from "@/lib/studio/constants";

export default async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; status?: string }>;
}) {
  const p = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  let query = supabase
    .from("outreach_contacts")
    .select("*")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });
  if (p.q) query = query.or(`name.ilike.%${p.q}%,handle_or_url.ilike.%${p.q}%`);
  if (p.type) query = query.eq("contact_type", p.type);
  if (p.status) query = query.eq("relationship_status", p.status);

  const [
    contactsResult,
    releasesResult,
    dueResult,
    campaignsResult,
    sequencesResult,
    stepsResult,
    enrollmentsResult,
    sequenceMessagesResult,
  ] = await Promise.all([
    query,
    supabase.from("releases").select("id,title,story,smart_link_url").eq("owner_id", user.id).order("title"),
    supabase
      .from("outreach_messages")
      .select("*,outreach_contacts(name)")
      .eq("owner_id", user.id)
      .lte("follow_up_at", new Date().toISOString())
      .order("follow_up_at"),
    marketing.from("campaigns").select("id,name,release_id,status").eq("owner_id", user.id).in("status", ["planned", "active", "paused"]).order("updated_at", { ascending: false }),
    marketing.from("outreach_sequences").select("*").eq("owner_id", user.id).order("updated_at", { ascending: false }),
    marketing.from("outreach_sequence_steps").select("*").eq("owner_id", user.id).order("step_order"),
    marketing.from("outreach_enrollments").select("*").eq("owner_id", user.id).order("updated_at", { ascending: false }),
    marketing.from("outreach_messages").select("*").eq("owner_id", user.id).not("sequence_enrollment_id", "is", null).order("created_at", { ascending: false }),
  ]);
  const firstError = [contactsResult, releasesResult, dueResult, campaignsResult, sequencesResult, stepsResult, enrollmentsResult, sequenceMessagesResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const contacts = contactsResult.data ?? [];
  const releases = releasesResult.data ?? [];
  const campaigns = campaignsResult.data ?? [];
  const sequences = sequencesResult.data ?? [];
  const steps = stepsResult.data ?? [];
  const enrollments = enrollmentsResult.data ?? [];
  const sequenceMessages = sequenceMessagesResult.data ?? [];
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const releaseById = new Map(releases.map((release) => [release.id, release]));
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const draftMessages = sequenceMessages.filter((message) => !message.sent_at);
  const activeEnrollments = enrollments.filter((enrollment) => ["active", "paused"].includes(enrollment.status));
  const template = (releaseTitle = "the new Atlas Irwin release") =>
    `Hi, I’m sharing ${releaseTitle}, a warm late-night electronic release built for movement. I thought it might fit your world. Happy to send context if useful.`;

  return (
    <>
      <PageHeader
        title="Outreach"
        description="Relationship CRM plus approval-first follow-up sequences for DJs, curators, communities, and creators."
        action={<a className="button primary" href="#new">New contact</a>}
      />

      <div className="studio-grid">
        <section className="studio-panel feature">
          <div className="panel-head"><h2>Sequence drafts to review</h2><Status>{draftMessages.length}</Status></div>
          {draftMessages.length ? draftMessages.map((message) => {
            const contact = contactById.get(message.contact_id);
            return (
              <article className="list-row" key={message.id}>
                <div>
                  <strong>{contact?.name || "Contact"}</strong>
                  <small>{message.channel} / generated draft, never auto-sent</small>
                  <p>{message.message}</p>
                  <CopyButton value={message.message} label="Copy message" />
                </div>
                <form action={markSequenceMessageSent}>
                  <input type="hidden" name="message_id" value={message.id} />
                  <button className="button primary" type="submit">I sent this</button>
                </form>
              </article>
            );
          }) : <EmptyState title="No sequence drafts waiting" body="When a sequence step becomes due, Atlas prepares the next message and stops until you review and send it." />}
        </section>

        <section className="studio-panel feature">
          <div className="panel-head"><h2>Manual follow-ups due</h2></div>
          {dueResult.data?.length ? dueResult.data.map((message) => (
            <div className="list-row" key={message.id}>
              <span>{(message.outreach_contacts as unknown as { name: string })?.name}<br /><small>{message.channel} / {message.response_status || "Awaiting response"}</small></span>
              <Status>Due</Status>
            </div>
          )) : <EmptyState title="Follow-up queue clear" body="No manual follow-ups are due today." />}
        </section>
      </div>

      <section className="studio-panel feature">
        <div className="panel-head"><div><span className="section-label">Automation with consent</span><h2>Outreach sequences</h2></div><span>{activeEnrollments.length} in motion</span></div>
        {sequences.length ? (
          <div className="studio-grid">
            {sequences.map((sequence) => {
              const campaign = sequence.campaign_id ? campaignById.get(sequence.campaign_id) : undefined;
              const release = campaign?.release_id ? releaseById.get(campaign.release_id) : undefined;
              const sequenceSteps = steps.filter((step) => step.sequence_id === sequence.id);
              const sequenceEnrollments = enrollments.filter((enrollment) => enrollment.sequence_id === sequence.id);
              return (
                <article className="studio-panel" key={sequence.id}>
                  <div className="panel-head"><div><Status>{sequence.status}</Status><h3>{sequence.name}</h3><small>{campaign?.name || "General"}{release ? ` / ${release.title}` : ""}</small></div></div>
                  <p>{sequenceSteps.map((step) => `${step.step_order + 1}. ${step.channel}, ${step.delay_days ? `after ${step.delay_days}d` : "now"}`).join(" / ")}</p>
                  <div className="actions">
                    <form action={updateOutreachSequenceStatus}>
                      <input type="hidden" name="sequence_id" value={sequence.id} />
                      <select name="status" defaultValue={sequence.status}><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option><option value="archived">Archived</option></select>
                      <button className="button" type="submit">Update</button>
                    </form>
                  </div>
                  {contacts.length ? (
                    <form action={enrollOutreachContact} className="studio-form">
                      <input type="hidden" name="sequence_id" value={sequence.id} />
                      <Field label="Enroll contact">
                        <select name="contact_id" required defaultValue=""><option value="" disabled>Select contact</option>{contacts.map((contact) => <option value={contact.id} key={contact.id}>{contact.name} / {contact.contact_type}</option>)}</select>
                      </Field>
                      <button className="button" type="submit">Create first draft</button>
                    </form>
                  ) : null}
                  {sequenceEnrollments.length ? <small>{sequenceEnrollments.map((enrollment) => `${contactById.get(enrollment.contact_id)?.name || "Contact"}: ${enrollment.status}`).join(" / ")}</small> : null}
                </article>
              );
            })}
          </div>
        ) : <EmptyState title="No outreach sequences" body="Create a two-step approval-first sequence for a live campaign. Atlas drafts each message at the right time and waits for you to send it." />}

        {campaigns.length ? (
          <details className="workspace-drawer">
            <summary>Create campaign sequence</summary>
            <form action={createOutreachSequence} className="studio-form">
              <div className="form-grid">
                <Field label="Campaign"><select name="campaign_id" required>{campaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name}</option>)}</select></Field>
                <Field label="Sequence name"><input name="name" required placeholder="DJ selector outreach" /></Field>
                <Field label="Channel"><input name="channel" defaultValue="Instagram DM" required /></Field>
                <Field label="Follow-up delay"><input type="number" name="followup_delay_days" min="1" max="30" defaultValue="7" /></Field>
                <Field label="First message" wide><textarea name="message_template" rows={5} required defaultValue={"Hi {{name}}, I’m sharing {{release}} because I think it could fit your world. {{link}}"} /></Field>
                <Field label="Follow-up" wide><textarea name="followup_template" rows={4} required defaultValue={"Hi {{name}}, just one gentle follow-up on {{release}} in case it got buried. No pressure at all. {{link}}"} /></Field>
              </div>
              <Submit>Create active sequence</Submit>
            </form>
          </details>
        ) : null}
      </section>

      <form className="studio-tabs">
        <input name="q" placeholder="Search contacts" defaultValue={p.q ?? ""} />
        <select name="type" defaultValue={p.type ?? ""}><option value="">All types</option>{CONTACT_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
        <select name="status" defaultValue={p.status ?? ""}><option value="">All relationships</option>{RELATIONSHIP_STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
        <button className="button">Filter</button>
      </form>

      {contacts.length ? (
        <table className="studio-table">
          <thead><tr><th>Contact</th><th>Type</th><th>Location</th><th>Relationship</th><th>Tags</th></tr></thead>
          <tbody>{contacts.map((contact) => <tr key={contact.id}><td><Link href={`/studio/outreach/${contact.id}`}><strong>{contact.name}</strong><br /><small>{contact.handle_or_url || contact.email}</small></Link></td><td>{contact.contact_type}</td><td>{[contact.city, contact.country].filter(Boolean).join(", ") || "Not set"}</td><td><Status>{contact.relationship_status}</Status></td><td>{contact.tags.join(", ")}</td></tr>)}</tbody>
        </table>
      ) : <EmptyState title="No outreach network yet" body="Add a person or outlet you genuinely want to build a relationship with." />}

      <section id="new" className="studio-panel feature">
        <div className="panel-head"><h2>Add contact</h2></div>
        <form action={saveContact} className="studio-form">
          <div className="form-grid">
            <Field label="Name"><input name="name" required /></Field>
            <Field label="Type"><select name="contact_type">{CONTACT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field>
            <Field label="Platform"><input name="platform" /></Field>
            <Field label="Handle or URL"><input name="handle_or_url" /></Field>
            <Field label="Email"><input name="email" type="email" /></Field>
            <Field label="City"><input name="city" /></Field>
            <Field label="Country"><input name="country" /></Field>
            <Field label="Audience size"><input name="audience_size" type="number" min="0" /></Field>
            <Field label="Contact method"><input name="contact_method" /></Field>
            <Field label="Relationship"><select name="relationship_status">{RELATIONSHIP_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></Field>
            <Field label="Genres"><input name="genres" placeholder="house, disco" /></Field>
            <Field label="Tags"><input name="tags" placeholder="Berlin, warm lead" /></Field>
            <Field label="Notes" wide><textarea name="notes" /></Field>
          </div>
          <Submit>Add contact</Submit>
        </form>
      </section>

      {contacts.length ? (
        <section className="studio-panel feature">
          <div className="panel-head"><h2>Log one-off message</h2></div>
          <form action={saveOutreachMessage} className="studio-form">
            <div className="form-grid">
              <Field label="Contact"><select name="contact_id">{contacts.map((contact) => <option value={contact.id} key={contact.id}>{contact.name}</option>)}</select></Field>
              <Field label="Release"><select name="release_id"><option value="">General</option>{releases.map((release) => <option value={release.id} key={release.id}>{release.title}</option>)}</select></Field>
              <Field label="Channel"><input name="channel" placeholder="Instagram DM" required /></Field>
              <Field label="Sent at"><input name="sent_at" type="datetime-local" /></Field>
              <Field label="Follow up at"><input name="follow_up_at" type="datetime-local" /></Field>
              <Field label="Response status"><input name="response_status" placeholder="Awaiting response" /></Field>
              <Field label="Message" wide><textarea name="message" rows={5} defaultValue={template(releases[0]?.title)} /><CopyButton value={template(releases[0]?.title)} label="Copy template" /></Field>
              <Field label="Response notes" wide><textarea name="response_notes" /></Field>
            </div>
            <Submit>Log message</Submit>
          </form>
        </section>
      ) : null}
    </>
  );
}
