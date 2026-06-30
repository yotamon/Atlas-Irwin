import { CopyButton } from "@/components/studio/copy-button";
import {
  Field,
  EmptyState,
  PageHeader,
  Status,
  Submit,
} from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  CONTENT_FORMATS,
  CONTENT_STATUSES,
  GOALS,
  PLATFORMS,
} from "@/lib/studio/constants";
import {
  deleteStudioRecord,
  duplicateContent,
  saveContent,
  updateContentStatus,
} from "@/app/studio/actions";
export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    release?: string;
    platform?: string;
    status?: string;
    goal?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase } = await requireStudioAdmin();
  let query = supabase
    .from("content_items")
    .select("*")
    .order("updated_at", { ascending: false });
  for (const key of ["release", "platform", "status", "goal"] as const) {
    if (params[key])
      query = query.eq(key === "release" ? "release_id" : key, params[key]!);
  }
  const [{ data: items }, { data: releases }] = await Promise.all([
    query,
    supabase.from("releases").select("id,title").order("title"),
  ]);
  const list = items ?? [];
  const view = params.view ?? "kanban";
  return (
    <>
      <PageHeader
        title="Content Lab"
        description="Develop, refine, and stage every piece before it goes live."
        action={
          <div className="actions">
            <a className="button primary" href="#new">
              New content item
            </a>
          </div>
        }
      />
      <form className="studio-tabs">
        <select name="release">
          <option value="">All releases</option>
          {releases?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
        <select name="platform">
          <option value="">All platforms</option>
          {PLATFORMS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select name="status">
          <option value="">All statuses</option>
          {CONTENT_STATUSES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select name="goal">
          <option value="">All goals</option>
          {GOALS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button className="button">Filter</button>
        <a href="?view=kanban">Kanban</a>
        <a href="?view=list">List</a>
      </form>
      {!list.length ? (
        <EmptyState
          title="No content in the lab"
          body="Create an idea here or generate a release-specific content pack."
        />
      ) : view === "list" ? (
        <table className="studio-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Platform</th>
              <th>Format</th>
              <th>Status</th>
              <th>Schedule</th>
            </tr>
          </thead>
          <tbody>
            {list.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.title}
                  <br />
                  <CopyButton value={item.hook_text} label="Copy hook" /> ·{" "}
                  <CopyButton value={item.caption} label="caption" /> ·{" "}
                  <CopyButton value={item.cta} label="CTA" /> ·{" "}
                  <CopyButton value={item.visual_prompt} label="prompt" />
                </td>
                <td>{item.platform}</td>
                <td>{item.format}</td>
                <td>
                  <Status>{item.status}</Status>
                </td>
                <td>
                  {item.scheduled_at
                    ? new Date(item.scheduled_at).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="kanban">
          {[
            "Idea",
            "Draft",
            "In Production",
            "Ready",
            "Scheduled",
            "Published",
          ].map((status) => (
            <section className="kanban-column" key={status}>
              <h2>
                {status} · {list.filter((x) => x.status === status).length}
              </h2>
              {list
                .filter((x) => x.status === status)
                .map((item) => (
                  <article className="kanban-card" key={item.id}>
                    <Status>{item.platform}</Status>
                    <h3>{item.title}</h3>
                    <p>{item.hook_text || item.goal}</p>
                    <CopyButton value={item.caption} label="Copy caption" />
                    <form action={duplicateContent}>
                      <input type="hidden" name="id" value={item.id} />
                      <button className="text-button">Duplicate</button>
                    </form>
                    <form action={updateContentStatus}>
                      <input type="hidden" name="id" value={item.id} />
                      <select name="status" defaultValue={item.status}>
                        {CONTENT_STATUSES.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                      <button className="text-button">Move</button>
                    </form>
                    <form action={deleteStudioRecord}>
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="table" value="content_items" />
                      <button className="text-button">Delete</button>
                    </form>
                  </article>
                ))}
            </section>
          ))}
        </div>
      )}
      <section id="new" className="studio-panel feature">
        <div className="panel-head">
          <h2>Create content item</h2>
        </div>
        <form action={saveContent} className="studio-form">
          <div className="form-grid">
            <Field label="Title">
              <input name="title" required />
            </Field>
            <Field label="Release">
              <select name="release_id">
                <option value="">No release</option>
                {releases?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Platform">
              <select name="platform">
                {PLATFORMS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Format">
              <select name="format">
                {CONTENT_FORMATS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select name="status">
                {CONTENT_STATUSES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Goal">
              <select name="goal">
                {GOALS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Scheduled">
              <input type="datetime-local" name="scheduled_at" />
            </Field>
            <Field label="Published">
              <input type="datetime-local" name="published_at" />
            </Field>
            <Field label="Audio start (seconds)">
              <input type="number" min="0" name="audio_timestamp_start" />
            </Field>
            <Field label="Audio end (seconds)">
              <input type="number" min="0" name="audio_timestamp_end" />
            </Field>
            <Field label="Hook" wide>
              <textarea name="hook_text" />
            </Field>
            <Field label="Caption" wide>
              <textarea name="caption" rows={4} />
            </Field>
            <Field label="CTA">
              <input name="cta" />
            </Field>
            <Field label="Asset URL">
              <input name="asset_url" type="url" />
            </Field>
            <Field label="Vertical visual prompt" wide>
              <textarea name="visual_prompt" rows={4} />
            </Field>
            <Field label="Production notes" wide>
              <textarea name="production_notes" />
            </Field>
            <Field label="Performance notes" wide>
              <textarea name="performance_notes" />
            </Field>
          </div>
          <Submit>Create content</Submit>
        </form>
      </section>
    </>
  );
}
