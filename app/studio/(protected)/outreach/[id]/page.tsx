import { notFound } from "next/navigation";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { PageHeader, Status, EmptyState } from "@/components/studio/ui";
import { CopyButton } from "@/components/studio/copy-button";
import {
  deleteStudioRecord,
  saveContact,
  updateOutreachResponse,
} from "@/app/studio/actions";
import { Field, Submit } from "@/components/studio/ui";
import { CONTACT_TYPES, RELATIONSHIP_STATUSES } from "@/lib/studio/constants";
export default async function ContactDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await requireStudioAdmin();
  const [{ data: contact }, { data: messages }] = await Promise.all([
    supabase.from("outreach_contacts").select("*").eq("id", id).single(),
    supabase
      .from("outreach_messages")
      .select("*,releases(title)")
      .eq("contact_id", id)
      .order("created_at", { ascending: false }),
  ]);
  if (!contact) notFound();
  return (
    <>
      <PageHeader
        title={contact.name}
        description={[contact.contact_type, contact.city, contact.country]
          .filter(Boolean)
          .join(" · ")}
        action={<Status>{contact.relationship_status}</Status>}
      />
      <div className="studio-grid">
        <section className="studio-panel feature">
          <h2>Contact record</h2>
          <p>
            {contact.handle_or_url ||
              contact.email ||
              "No direct contact route recorded."}
          </p>
          <p>{contact.notes}</p>
          <small>{contact.tags.join(" · ")}</small>
        </section>
        <section className="studio-panel">
          <h2>Activity timeline</h2>
          {messages?.length ? (
            messages.map((m) => (
              <article className="timeline-row" key={m.id}>
                <span>
                  {m.channel}
                  <br />
                  <small>{m.message}</small>
                  <br />
                  <CopyButton value={m.message} />
                </span>
                <span>
                  <Status>{m.response_status || "Sent"}</Status>
                  <br />
                  <small>
                    {new Date(m.sent_at || m.created_at).toLocaleDateString()}
                  </small>
                </span>
              </article>
            ))
          ) : (
            <EmptyState
              title="No outreach logged"
              body="Messages logged for this contact will form the relationship timeline."
            />
          )}
        </section>
      </div>
      <section className="studio-panel feature">
        <div className="panel-head">
          <h2>Edit contact</h2>
        </div>
        <form action={saveContact} className="studio-form">
          <input type="hidden" name="id" value={contact.id} />
          <div className="form-grid">
            <Field label="Name">
              <input name="name" defaultValue={contact.name} required />
            </Field>
            <Field label="Type">
              <select name="contact_type" defaultValue={contact.contact_type}>
                {CONTACT_TYPES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Platform">
              <input name="platform" defaultValue={contact.platform ?? ""} />
            </Field>
            <Field label="Handle or URL">
              <input
                name="handle_or_url"
                defaultValue={contact.handle_or_url ?? ""}
              />
            </Field>
            <Field label="Email">
              <input
                name="email"
                type="email"
                defaultValue={contact.email ?? ""}
              />
            </Field>
            <Field label="City">
              <input name="city" defaultValue={contact.city ?? ""} />
            </Field>
            <Field label="Country">
              <input name="country" defaultValue={contact.country ?? ""} />
            </Field>
            <Field label="Audience size">
              <input
                name="audience_size"
                type="number"
                min="0"
                defaultValue={contact.audience_size ?? ""}
              />
            </Field>
            <Field label="Contact method">
              <input
                name="contact_method"
                defaultValue={contact.contact_method ?? ""}
              />
            </Field>
            <Field label="Relationship">
              <select
                name="relationship_status"
                defaultValue={contact.relationship_status}
              >
                {RELATIONSHIP_STATUSES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Genres">
              <input name="genres" defaultValue={contact.genres.join(", ")} />
            </Field>
            <Field label="Tags">
              <input name="tags" defaultValue={contact.tags.join(", ")} />
            </Field>
            <Field label="Notes" wide>
              <textarea name="notes" defaultValue={contact.notes ?? ""} />
            </Field>
          </div>
          <Submit>Save contact</Submit>
        </form>
        <form action={deleteStudioRecord}>
          <input type="hidden" name="id" value={contact.id} />
          <input type="hidden" name="table" value="outreach_contacts" />
          <button className="text-button">Delete contact</button>
        </form>
      </section>
      {messages?.map((message) => (
        <details className="studio-panel feature" key={`edit-${message.id}`}>
          <summary>Update response · {message.channel}</summary>
          <form action={updateOutreachResponse} className="studio-form">
            <input type="hidden" name="id" value={message.id} />
            <div className="form-grid">
              <Field label="Response status">
                <input
                  name="response_status"
                  defaultValue={message.response_status ?? ""}
                />
              </Field>
              <Field label="Next follow-up">
                <input name="follow_up_at" type="datetime-local" />
              </Field>
              <Field label="Response notes" wide>
                <textarea
                  name="response_notes"
                  defaultValue={message.response_notes ?? ""}
                />
              </Field>
            </div>
            <Submit>Update response</Submit>
          </form>
          <form action={deleteStudioRecord}>
            <input type="hidden" name="id" value={message.id} />
            <input type="hidden" name="table" value="outreach_messages" />
            <button className="text-button">Delete message</button>
          </form>
        </details>
      ))}
    </>
  );
}
