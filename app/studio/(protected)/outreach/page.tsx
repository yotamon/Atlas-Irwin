import Link from "next/link";
import { saveContact, saveOutreachMessage } from "@/app/studio/actions";
import { CopyButton } from "@/components/studio/copy-button";
import {
  EmptyState,
  Field,
  PageHeader,
  Status,
  Submit,
} from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { CONTACT_TYPES, RELATIONSHIP_STATUSES } from "@/lib/studio/constants";
export default async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; status?: string }>;
}) {
  const p = await searchParams;
  const { supabase } = await requireStudioAdmin();
  let query = supabase
    .from("outreach_contacts")
    .select("*")
    .order("updated_at", { ascending: false });
  if (p.q) query = query.or(`name.ilike.%${p.q}%,handle_or_url.ilike.%${p.q}%`);
  if (p.type) query = query.eq("contact_type", p.type);
  if (p.status) query = query.eq("relationship_status", p.status);
  const [{ data: contacts }, { data: releases }, { data: due }] =
    await Promise.all([
      query,
      supabase
        .from("releases")
        .select("id,title,story,smart_link_url")
        .order("title"),
      supabase
        .from("outreach_messages")
        .select("*,outreach_contacts(name)")
        .lte("follow_up_at", new Date().toISOString())
        .order("follow_up_at"),
    ]);
  const template = (releaseTitle = "the new Atlas Irwin release") =>
    `Hi — I’m sharing ${releaseTitle}, a warm, late-night electronic release built for movement. I thought it might fit your world. Happy to send a private link and context if useful.`;
  return (
    <>
      <PageHeader
        title="Outreach"
        description="Build real relationships with selectors, curators, communities, and creators."
        action={
          <a className="button primary" href="#new">
            New contact
          </a>
        }
      />
      <section className="studio-panel feature">
        <div className="panel-head">
          <h2>Follow-ups due today</h2>
        </div>
        {due?.length ? (
          due.map((m) => (
            <div className="list-row" key={m.id}>
              <span>
                {(m.outreach_contacts as unknown as { name: string })?.name}
                <br />
                <small>
                  {m.channel} · {m.response_status || "Awaiting response"}
                </small>
              </span>
              <Status>Due</Status>
            </div>
          ))
        ) : (
          <EmptyState
            title="Follow-up queue clear"
            body="No manual follow-ups are due today."
          />
        )}
      </section>
      <form className="studio-tabs">
        <input name="q" placeholder="Search contacts" />
        <select name="type">
          <option value="">All types</option>
          {CONTACT_TYPES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select name="status">
          <option value="">All relationships</option>
          {RELATIONSHIP_STATUSES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button className="button">Filter</button>
      </form>
      {contacts?.length ? (
        <table className="studio-table">
          <thead>
            <tr>
              <th>Contact</th>
              <th>Type</th>
              <th>Location</th>
              <th>Relationship</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/studio/outreach/${c.id}`}>
                    <strong>{c.name}</strong>
                    <br />
                    <small>{c.handle_or_url || c.email}</small>
                  </Link>
                </td>
                <td>{c.contact_type}</td>
                <td>{[c.city, c.country].filter(Boolean).join(", ") || "—"}</td>
                <td>
                  <Status>{c.relationship_status}</Status>
                </td>
                <td>{c.tags.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState
          title="No outreach network yet"
          body="Add a person or outlet you genuinely want to build a relationship with."
        />
      )}
      <section id="new" className="studio-panel feature">
        <div className="panel-head">
          <h2>Add contact</h2>
        </div>
        <form action={saveContact} className="studio-form">
          <div className="form-grid">
            <Field label="Name">
              <input name="name" required />
            </Field>
            <Field label="Type">
              <select name="contact_type">
                {CONTACT_TYPES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Platform">
              <input name="platform" />
            </Field>
            <Field label="Handle or URL">
              <input name="handle_or_url" />
            </Field>
            <Field label="Email">
              <input name="email" type="email" />
            </Field>
            <Field label="City">
              <input name="city" />
            </Field>
            <Field label="Country">
              <input name="country" />
            </Field>
            <Field label="Audience size">
              <input name="audience_size" type="number" min="0" />
            </Field>
            <Field label="Contact method">
              <input name="contact_method" />
            </Field>
            <Field label="Relationship">
              <select name="relationship_status">
                {RELATIONSHIP_STATUSES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Genres">
              <input name="genres" placeholder="house, disco" />
            </Field>
            <Field label="Tags">
              <input name="tags" placeholder="Berlin, warm lead" />
            </Field>
            <Field label="Notes" wide>
              <textarea name="notes" />
            </Field>
          </div>
          <Submit>Add contact</Submit>
        </form>
      </section>
      {contacts?.length && (
        <section className="studio-panel feature">
          <div className="panel-head">
            <h2>Log outreach message</h2>
          </div>
          <form action={saveOutreachMessage} className="studio-form">
            <div className="form-grid">
              <Field label="Contact">
                <select name="contact_id">
                  {contacts.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Release">
                <select name="release_id">
                  <option value="">General</option>
                  {releases?.map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Channel">
                <input name="channel" placeholder="Instagram DM" required />
              </Field>
              <Field label="Sent at">
                <input name="sent_at" type="datetime-local" />
              </Field>
              <Field label="Follow up at">
                <input name="follow_up_at" type="datetime-local" />
              </Field>
              <Field label="Response status">
                <input name="response_status" placeholder="Awaiting response" />
              </Field>
              <Field label="Message" wide>
                <textarea
                  name="message"
                  rows={5}
                  defaultValue={template(releases?.[0]?.title)}
                />
                <CopyButton
                  value={template(releases?.[0]?.title)}
                  label="Copy template"
                />
              </Field>
              <Field label="Response notes" wide>
                <textarea name="response_notes" />
              </Field>
            </div>
            <Submit>Log message</Submit>
          </form>
        </section>
      )}
    </>
  );
}
